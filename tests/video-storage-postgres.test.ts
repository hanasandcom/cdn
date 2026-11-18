import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test'
import pg from 'pg'

// Run alone against an explicitly isolated database; no application configuration is loaded.
assert.equal(process.env.CDN_TRASH_TEST_DB, '1')
assert.equal(process.env.DB, 'cdn_trash_test')
assert.equal(process.env.DB_USER, 'cdn_trash_test')
assert.equal(process.env.DB_HOST, '127.0.0.1')
const port = Number(process.env.DB_PORT)
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && ![5432, 8502].includes(port))
assert.ok(process.env.DB_PASSWORD)
const schema = `video_storage_test_${randomUUID().replaceAll('-', '')}`
assert.match(schema, /^video_storage_test_[a-f0-9]{32}$/)
const workerName = schema + '_worker'
const options = { host: '127.0.0.1', port, database: 'cdn_trash_test', user: 'cdn_trash_test',
    password: process.env.DB_PASSWORD, connectionTimeoutMillis: 3000, statement_timeout: 5000 }
const control = new pg.Client({ ...options, application_name: schema + '_control' })
const pool = new pg.Pool({ ...options, application_name: workerName, max: 3, options: `-c search_path=${schema}` })
const directory = await mkdtemp(join(tmpdir(), 'cdn-video-postgres-'))
process.env.CDN_STORAGE_DIR = directory
process.env.CDN_MIN_FREE_BYTES = '1'
process.env.CDN_STORAGE_LIMIT_BYTES = String(1024 * 1024)
// Only replace pool construction: every query/transaction executes on real PostgreSQL.
mock.module('../src/utils/db/pool.ts', () => ({ default: pool }))
const { storeVideoDerivative } = await import('../src/utils/fileStorage.ts')
let connected = false
let created = false
let originalKey = ''
const originalBytes = Buffer.from('synthetic-original-not-to-be-mutated')
let sequence = 0

async function temporary() {
    const path = join(directory, `fixture-${++sequence}`)
    await writeFile(path, Buffer.from('synthetic-derivative'))
    return path
}
async function blockedWorker() {
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
        const result = await control.query(`SELECT pid FROM pg_stat_activity
            WHERE application_name=$1 AND wait_event_type='Lock'`, [workerName])
        if (result.rowCount) return
        await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Expected the real derivative transaction to wait for the row lock.')
}

beforeAll(async () => {
    await control.connect()
    connected = true
    expect((await control.query('SELECT current_database() AS db,current_user AS username')).rows[0])
        .toEqual({ db: 'cdn_trash_test', username: 'cdn_trash_test' })
    await control.query(`CREATE SCHEMA ${schema}`)
    created = true
    await control.query(`SET search_path TO ${schema}`)
    await control.query(`CREATE TABLE files (
        id TEXT PRIMARY KEY, data BYTEA NOT NULL, storage_key TEXT, storage_size BIGINT,
        thumbnail_storage_key TEXT, thumbnail_size BIGINT, thumbnail_processed BOOLEAN DEFAULT FALSE,
        playback_storage_key TEXT, playback_size BIGINT, deleted_at TIMESTAMPTZ, purge_started_at TIMESTAMPTZ
    )`)
})
beforeEach(async () => {
    await control.query('DELETE FROM files')
    for (const name of await readdir(directory)) await rm(join(directory, name), { force: true })
    originalKey = randomUUID()
    await writeFile(join(directory, originalKey), originalBytes)
    await control.query('INSERT INTO files(id,data,storage_key,storage_size) VALUES ($1,$2,$3,$4)',
        ['fixture', originalBytes, originalKey, originalBytes.length])
})
afterAll(async () => {
    await pool.end()
    if (connected) {
        try {
            await control.query('ROLLBACK')
            if (created) await control.query(`DROP SCHEMA ${schema} CASCADE`)
        } finally { await control.end() }
    }
    await rm(directory, { recursive: true, force: true })
})

test('real transactions attach both derivatives and preserve the original', async () => {
    for (const variant of ['thumbnail', 'playback'] as const) {
        const path = await temporary()
        expect(await storeVideoDerivative('fixture', originalKey, variant, path)).toBe(true)
        const row = (await control.query('SELECT * FROM files WHERE id=$1', ['fixture'])).rows[0]
        expect(row[`${variant}_storage_key`]).toMatch(/^[a-f0-9-]{36}$/)
        expect(Number(row[`${variant}_size`])).toBe(20)
        expect(await readFile(join(directory, row[`${variant}_storage_key`]), 'utf8')).toBe('synthetic-derivative')
        if (variant === 'thumbnail') expect(row.thumbnail_processed).toBe(true)
        expect(await readFile(join(directory, originalKey))).toEqual(originalBytes)
        const duplicate = await temporary()
        expect(await storeVideoDerivative('fixture', originalKey, variant, duplicate)).toBe(false)
        expect(await readFile(duplicate, 'utf8')).toBe('synthetic-derivative')
    }
})

for (const change of ['trash', 'purge', 'replacement', 'delete'] as const) {
    test(`attachment waits for concurrent ${change}, rechecks state, and cannot resurrect a derivative`, async () => {
        const path = await temporary()
        const before = (await readdir(directory)).sort()
        await control.query('BEGIN')
        if (change === 'trash') await control.query('UPDATE files SET deleted_at=NOW() WHERE id=$1', ['fixture'])
        if (change === 'purge') await control.query('UPDATE files SET purge_started_at=NOW() WHERE id=$1', ['fixture'])
        if (change === 'replacement') await control.query('UPDATE files SET storage_key=$2 WHERE id=$1', ['fixture', randomUUID()])
        if (change === 'delete') await control.query('DELETE FROM files WHERE id=$1', ['fixture'])
        let settled = false
        const result = storeVideoDerivative('fixture', originalKey, 'playback', path)
            .then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
        try {
            await blockedWorker()
            expect(settled).toBe(false)
            await control.query('COMMIT')
            expect(await result).toEqual({ value: false })
            const row = (await control.query('SELECT playback_storage_key FROM files WHERE id=$1', ['fixture'])).rows[0]
            expect(row?.playback_storage_key ?? null).toBeNull()
            expect((await readdir(directory)).sort()).toEqual(before)
            expect(await readFile(join(directory, originalKey))).toEqual(originalBytes)
        } finally {
            await control.query('ROLLBACK')
            await result
        }
    })
}

test('actual SQL failure after promotion rolls back metadata and removes the generated orphan', async () => {
    await control.query(`CREATE FUNCTION reject_video_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.playback_storage_key IS NOT NULL THEN RAISE EXCEPTION 'synthetic attachment failure'; END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER reject_video BEFORE UPDATE ON files FOR EACH ROW EXECUTE FUNCTION reject_video_attachment()`)
    try {
        const path = await temporary()
        await expect(storeVideoDerivative('fixture', originalKey, 'playback', path)).rejects.toThrow('synthetic attachment failure')
        expect((await readdir(directory)).sort()).toEqual([originalKey])
        const row = (await control.query('SELECT playback_storage_key,playback_size FROM files WHERE id=$1', ['fixture'])).rows[0]
        expect(row).toEqual({ playback_storage_key: null, playback_size: null })
        expect(await readFile(join(directory, originalKey))).toEqual(originalBytes)
    } finally {
        await control.query('DROP TRIGGER reject_video ON files; DROP FUNCTION reject_video_attachment()')
    }
})
