import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'
import pg from 'pg'

// Run alone. Only explicit synthetic PostgreSQL targets and generated temp files are used.
assert.equal(process.env.CDN_TRASH_TEST_DB, '1')
assert.equal(process.env.DB, 'cdn_trash_test')
assert.equal(process.env.DB_USER, 'cdn_trash_test')
assert.equal(process.env.DB_HOST, '127.0.0.1')
assert.ok(process.env.DB_PASSWORD)
const port = Number(process.env.DB_PORT)
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && ![5432, 8502].includes(port))
const client = new pg.Client({ host: '127.0.0.1', port, database: 'cdn_trash_test', user: 'cdn_trash_test',
    password: process.env.DB_PASSWORD, connectionTimeoutMillis: 3000, statement_timeout: 5000 })
mock.module('#db', () => ({
    default: (sql: string, params?: unknown[]) => client.query(sql, params),
    withClient: (work: (db: pg.Client) => Promise<unknown>) => work(client),
}))
mock.module('#constants', () => ({ default: { auth_api: 'https://trash-auth.invalid/api', DB_PASSWORD: 'synthetic-only' } }))
let directory = ''
let failingKey = ''
const knownKeys = new Set<string>()
const removedKeys: string[] = []
class StorageError extends Error {
    constructor(public statusCode: number, message: string) { super(message) }
}
mock.module('../src/utils/fileStorage.ts', () => ({
    StorageError,
    persistFile: async () => { throw new Error('Trashed files must never reach replacement storage.') },
    removeStoredFiles: async (keys: Array<string | undefined>) => {
        for (const key of keys.filter(Boolean) as string[]) {
            assert.ok(directory && knownKeys.has(key), 'Only generated synthetic storage keys may be removed.')
            if (key === failingKey) throw new Error('Synthetic unlink failure')
            await unlink(join(directory, key)).catch(error => { if (error.code !== 'ENOENT') throw error })
            removedKeys.push(key)
        }
    },
}))
const { default: deleteFile } = await import('../src/handlers/files/delete.ts')
const { default: putFile } = await import('../src/handlers/files/put.ts')
const { default: getUserFiles } = await import('../src/handlers/files/getUserFiles.ts')
const { default: getUserTimeline } = await import('../src/handlers/files/getUserTimeline.ts')
const { getTrash, restoreFile, permanentlyDeleteFile } = await import('../src/handlers/files/trash.ts')
const { getAlbum, getPublicAlbum, listAlbums, deleteAlbum } = await import('../src/handlers/albums.ts')
const { purgeExpiredTrash } = await import('../src/utils/fileTrash.ts')
const { default: ensureSchema } = await import('../src/utils/schema.ts')
const app = Fastify()
app.delete('/api/files/:id', deleteFile)
app.put('/api/files/:id', putFile)
app.get('/api/files/trash', getTrash)
app.post('/api/files/:id/restore', restoreFile)
app.delete('/api/files/:id/permanent', permanentlyDeleteFile)
app.get('/api/files/user/:id', getUserFiles)
app.get('/api/files/user/:id/timeline', getUserTimeline)
app.get('/api/albums', listAlbums)
app.get('/api/albums/:id', getAlbum)
app.delete('/api/albums/:id', deleteAlbum)
app.get('/api/albums/public/:token', getPublicAlbum)
const originalFetch = globalThis.fetch
let connected = false
let keys: string[] = []
const bytes = Buffer.from('synthetic-original-preservation-fixture')
function headers(user = 'owner-test', origin = 'http://cdn.test') {
    return { host: 'cdn.test', origin, ...(user ? { cookie: `id=${user}; access_token=synthetic-token` } : {}) }
}
async function get(url: string, user = 'owner-test') {
    const response = await app.inject({ method: 'GET', url, headers: headers(user) })
    expect(response.statusCode).toBe(200)
    return response.json()
}
function trash(id = 'photo-private', user = 'owner-test') {
    return app.inject({ method: 'DELETE', url: `/api/files/${id}`, headers: headers(user) })
}

beforeAll(async () => {
    await client.connect()
    connected = true
    const identity = (await client.query('SELECT current_database() AS db,current_user AS username')).rows[0]
    assert.deepEqual(identity, { db: 'cdn_trash_test', username: 'cdn_trash_test' })
    await client.query('BEGIN')
    const schema = `trash_test_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET LOCAL search_path TO ${schema}`)
    await client.query(`CREATE TABLE files (
        id TEXT PRIMARY KEY,name TEXT,description TEXT,type TEXT,path TEXT,data BYTEA,uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE request_logs (domain TEXT,ip INET,user_agent TEXT,path TEXT,hits BIGINT,last_seen TIMESTAMPTZ);
    CREATE TABLE request_logs_all (LIKE request_logs);`)
    await ensureSchema()
    directory = await mkdtemp(join(tmpdir(), 'cdn-trash-test-'))
    await app.ready()
})
beforeEach(async () => {
    failingKey = ''
    removedKeys.length = 0
    globalThis.fetch = (async (input, init) => {
        const target = new URL(String(input))
        assert.equal(target.origin, 'https://trash-auth.invalid')
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token')
        const id = target.pathname.split('/').at(-1)
        return ['owner-test', 'member-test', 'outsider-test'].includes(id || '')
            ? Response.json({ id, token: 'synthetic-token', expires_at: '2099-01-01T00:00:00Z' })
            : Response.json({}, { status: 401 })
    }) as typeof fetch
    await client.query('DELETE FROM photo_albums; DELETE FROM files;')
    keys = Array.from({ length: 3 }, () => randomUUID())
    for (const key of keys) { knownKeys.add(key); await writeFile(join(directory, key), bytes) }
    await client.query(`INSERT INTO files (id,name,type,owner,data,path,storage_key,storage_size,thumbnail_storage_key,
        thumbnail_size,playback_storage_key,playback_size) VALUES
        ('photo-private','Private trip.jpg','image/jpeg','owner-test',$1,'private',$2,39,$3,39,$4,39),
        ('photo-public','Public trip.mov','video/quicktime','owner-test',$1,'public',NULL,NULL,NULL,NULL,NULL,NULL);
        `, [bytes, ...keys])
    await client.query(`INSERT INTO photo_albums (id,owner,name,public_token) VALUES
        ('private-album','owner-test','Private',NULL), ('public-album','owner-test','Public','public-test-token');
        INSERT INTO photo_album_items (album_id,file_id,added_by) VALUES
        ('private-album','photo-private','owner-test'),('public-album','photo-public','owner-test');
        INSERT INTO photo_album_members (album_id,user_id) VALUES ('private-album','member-test');`)
})
afterAll(async () => {
    globalThis.fetch = originalFetch
    await app.close()
    if (connected) { try { await client.query('ROLLBACK') } finally { await client.end() } }
    if (directory) await rm(directory, { recursive: true, force: true })
})

test('trash preserves bytes and album links while hiding media from ordinary queries and counts', async () => {
    const response = await trash()
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ deleted: 'photo-private', trashed: true })
    const repeated = await trash()
    expect(repeated.json().deleted_at).toBe(response.json().deleted_at)
    expect(Date.parse(response.json().expires_at) - Date.parse(response.json().deleted_at)).toBe(30 * 24 * 60 * 60 * 1000)
    expect((await trash('photo-public')).statusCode).toBe(200)
    for (const key of keys) expect(await readFile(join(directory, key))).toEqual(bytes)
    expect(removedKeys).toEqual([])
    expect((await client.query('SELECT * FROM photo_album_items')).rowCount).toBe(2)
    expect(await get('/api/files/user/owner-test?media=all')).toEqual([])
    expect(await get('/api/files/user/owner-test/timeline')).toEqual([])
    for (const album of await get('/api/albums')) {
        expect(album.photo_count).toBe(0)
        expect(album.cover_file_id).toBeNull()
    }
    expect(await get('/api/albums/private-album')).toMatchObject({ items: [], timeline: [], total: 0 })
    expect(await get('/api/albums/public/public-test-token')).toMatchObject({ items: [], timeline: [], total: 0 })
    expect((await get('/api/files/trash?search=private&limit=1&offset=0')).map((file: { id: string }) => file.id))
        .toEqual(['photo-private'])
    expect(await get('/api/files/trash?search=absent')).toEqual([])
    expect(await get('/api/files/trash', 'outsider-test')).toEqual([])
})

test('restore keeps album associations and sticky privacy even after the private album is deleted', async () => {
    await trash()
    const restored = await app.inject({ method: 'POST', url: '/api/files/photo-private/restore', headers: headers() })
    expect(restored.statusCode).toBe(200)
    expect(restored.json()).toEqual({ restored: 'photo-private' })
    expect((await get('/api/albums/private-album')).total).toBe(1)
    await trash()
    const removed = await app.inject({ method: 'DELETE', url: '/api/albums/private-album', headers: headers() })
    expect(removed.statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/api/files/photo-private/restore', headers: headers() })).statusCode).toBe(200)
    const file = (await client.query('SELECT deleted_at,restore_private FROM files WHERE id=\'photo-private\'')).rows[0]
    expect(file).toEqual({ deleted_at: null, restore_private: true })
    expect(await readFile(join(directory, keys[0]))).toEqual(bytes)
})

test('trash and recovery actions enforce owner access, authentication, and cookie origin checks', async () => {
    expect((await trash('photo-private', 'member-test')).statusCode).toBe(404)
    expect((await trash('photo-private', 'outsider-test')).statusCode).toBe(404)
    expect((await trash('photo-private', '')).statusCode).toBe(401)
    for (const origin of ['', 'https://attacker.example']) {
        expect((await app.inject({ method: 'DELETE', url: '/api/files/photo-private', headers: headers('owner-test', origin) }))
            .statusCode).toBe(403)
    }
    await trash()
    for (const [method, action] of [['POST', 'restore'], ['DELETE', 'permanent']] as const) {
        expect((await app.inject({ method, url: `/api/files/photo-private/${action}`, headers: headers('outsider-test') }))
            .statusCode).toBe(404)
    }
    expect(await readFile(join(directory, keys[0]))).toEqual(bytes)
})

test('permanent deletion requires trash and removes original, thumbnail, and playback only for that file', async () => {
    const active = await app.inject({ method: 'DELETE', url: '/api/files/photo-private/permanent', headers: headers() })
    expect(active.statusCode).toBe(404)
    expect(removedKeys).toEqual([])
    await trash()
    const response = await app.inject({ method: 'DELETE', url: '/api/files/photo-private/permanent', headers: headers() })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ deleted: 'photo-private' })
    expect(removedKeys).toEqual(keys)
    expect((await client.query('SELECT * FROM files WHERE id=\'photo-private\'')).rowCount).toBe(0)
    expect((await client.query('SELECT * FROM photo_album_items WHERE file_id=\'photo-private\'')).rowCount).toBe(0)
    expect((await client.query('SELECT data FROM files WHERE id=\'photo-public\'')).rows[0].data).toEqual(bytes)
})

test('partial cleanup failure blocks restore and a later sweep retries the durable purge marker', async () => {
    await trash()
    failingKey = keys[1]
    const response = await app.inject({ method: 'DELETE', url: '/api/files/photo-private/permanent', headers: headers() })
    expect(response.statusCode).toBe(503)
    expect((await client.query('SELECT purge_started_at FROM files WHERE id=\'photo-private\'')).rows[0].purge_started_at).not.toBeNull()
    expect((await app.inject({ method: 'POST', url: '/api/files/photo-private/restore', headers: headers() })).statusCode).toBe(404)
    expect(await get('/api/files/trash')).toEqual([])
    expect(await purgeExpiredTrash()).toEqual({ deleted: 0, failed: 1 })
    failingKey = ''
    expect(await purgeExpiredTrash()).toEqual({ deleted: 1, failed: 0 })
    expect((await client.query('SELECT * FROM files WHERE id=\'photo-private\'')).rowCount).toBe(0)
})

test('expiration refuses restore at 30 days and deletes at most five expired files per sweep', async () => {
    await trash()
    await client.query('UPDATE files SET deleted_at=NOW()-INTERVAL \'29 days\' WHERE id=\'photo-private\'')
    await client.query(`INSERT INTO files (id,name,type,owner,data,path,deleted_at)
        SELECT 'expired-'||n,'Expired','image/jpeg','owner-test',$1,'expired-'||n,NOW()-INTERVAL '30 days'
        FROM generate_series(1,7) n`, [bytes])
    expect((await app.inject({ method: 'POST', url: '/api/files/expired-1/restore', headers: headers() })).statusCode).toBe(404)
    expect(await purgeExpiredTrash(1000)).toEqual({ deleted: 5, failed: 0 })
    expect(await purgeExpiredTrash()).toEqual({ deleted: 2, failed: 0 })
    expect((await client.query('SELECT id FROM files ORDER BY id')).rows.map(row => row.id)).toEqual(['photo-private', 'photo-public'])
    expect(await readFile(join(directory, keys[0]))).toEqual(bytes)
})

test('PUT cannot alter or replace a trashed original', async () => {
    await trash()
    for (const payload of [{ name: 'Changed' }, { data: bytes.toString('base64') }]) {
        const response = await app.inject({ method: 'PUT', url: '/api/files/photo-private',
            headers: { host: 'cdn.test', id: 'owner-test', authorization: 'Bearer synthetic-token' }, payload })
        expect(response.statusCode).toBe(404)
    }
    expect((await client.query('SELECT name FROM files WHERE id=\'photo-private\'')).rows[0].name).toBe('Private trip.jpg')
    expect(await readFile(join(directory, keys[0]))).toEqual(bytes)
    expect(removedKeys).toEqual([])
})
