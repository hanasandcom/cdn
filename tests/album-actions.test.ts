import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'
import pg from 'pg'

// Run this file alone: its database adapter uses one real PostgreSQL transaction.
// Require an explicit synthetic target before importing application modules or connecting.
assert.equal(process.env.CDN_ALBUM_TEST_DB, '1', 'Set CDN_ALBUM_TEST_DB=1 for the isolated album database test.')
assert.equal(process.env.DB, 'cdn_album_actions_test')
assert.equal(process.env.DB_USER, 'cdn_album_actions_test')
assert.equal(process.env.DB_HOST, '127.0.0.1')
assert.ok(process.env.DB_PASSWORD, 'An explicit synthetic database password is required.')
const port = Number(process.env.DB_PORT)
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535 && ![5432, 8502].includes(port),
    'Use an explicit isolated loopback PostgreSQL port, not the normal database ports.')

const client = new pg.Client({
    host: '127.0.0.1', port, database: 'cdn_album_actions_test', user: 'cdn_album_actions_test',
    password: process.env.DB_PASSWORD, connectionTimeoutMillis: 3000, statement_timeout: 5000,
})
let deleteAlbumBeforePinInsert = false
mock.module('#db', () => ({
    default: async (sql: string, params?: unknown[]) => {
        if (deleteAlbumBeforePinInsert && sql.includes('INSERT INTO photo_album_pins')) {
            deleteAlbumBeforePinInsert = false
            // Interleave deletion after the handler's access check, before its write.
            await client.query('DELETE FROM photo_albums WHERE id=$1', [params?.[1]])
            await client.query('SAVEPOINT pin_insert')
            try {
                return await client.query(sql, params)
            } catch (error) {
                // Production uses autocommit; keep our enclosing test transaction usable.
                await client.query('ROLLBACK TO SAVEPOINT pin_insert')
                throw error
            } finally {
                await client.query('RELEASE SAVEPOINT pin_insert')
            }
        }
        return client.query(sql, params)
    },
    withClient: (work: (connection: pg.Client) => Promise<unknown>) => work(client),
}))
mock.module('#constants', () => ({ default: { auth_api: 'https://album-auth.invalid/api' } }))
const handlers = await import('../src/handlers/albums.ts')
const { default: ensureSchema } = await import('../src/utils/schema.ts')
const app = Fastify()
app.get('/api/albums', handlers.listAlbums)
app.get('/api/albums/:id', handlers.getAlbum)
app.patch('/api/albums/:id', handlers.updateAlbum)
app.delete('/api/albums/:id', handlers.deleteAlbum)
app.put('/api/albums/:id/pin', handlers.pinAlbum)
app.post('/api/albums/:id/members', handlers.addAlbumMember)
app.delete('/api/albums/:id/members/:userId', handlers.removeAlbumMember)

const originalFetch = globalThis.fetch
let connected = false
const users = new Set(['owner-test', 'viewer-test', 'contributor-test', 'outsider-test'])
function headers(user = 'owner-test', origin: string | null = 'http://cdn.test') {
    return { host: 'cdn.test', ...(origin === null ? {} : { origin }),
        ...(user ? { cookie: `id=${user}; access_token=synthetic-token` } : {}) }
}
function pin(user: string, isPinned: unknown, id = 'album-old', origin: string | null = 'http://cdn.test') {
    return app.inject({ method: 'PUT', url: `/api/albums/${id}/pin`, headers: headers(user, origin),
        payload: { isPinned } })
}
async function albums(user: string) {
    const response = await app.inject({ method: 'GET', url: '/api/albums', headers: headers(user) })
    expect(response.statusCode).toBe(200)
    return response.json() as Array<{ id: string, is_pinned: boolean, member_role: string, photo_count: number }>
}

beforeAll(async () => {
    await client.connect()
    connected = true
    const identity = await client.query('SELECT current_database() AS db, current_user AS username')
    assert.deepEqual(identity.rows[0], { db: 'cdn_album_actions_test', username: 'cdn_album_actions_test' })
    await client.query('BEGIN')
    const schema = `album_test_${randomUUID().replaceAll('-', '')}`
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET LOCAL search_path TO ${schema}`)
    await client.query(`CREATE TABLE files (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, data BYTEA, uploaded_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE request_logs (domain TEXT, ip INET, user_agent TEXT, path TEXT, hits BIGINT, last_seen TIMESTAMPTZ);
    CREATE TABLE request_logs_all (LIKE request_logs);`)
    await ensureSchema()
    await ensureSchema()
    await app.ready()
})

beforeEach(async () => {
    deleteAlbumBeforePinInsert = false
    globalThis.fetch = (async (input, init) => {
        const target = new URL(String(input))
        assert.equal(target.origin, 'https://album-auth.invalid')
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic-token')
        const id = decodeURIComponent(target.pathname.split('/').at(-1) || '')
        return users.has(id)
            ? Response.json({ id, token: 'synthetic-token', expires_at: '2099-01-01T00:00:00.000Z' })
            : Response.json({ error: 'Invalid session' }, { status: 401 })
    }) as typeof fetch
    await client.query('DELETE FROM photo_albums; DELETE FROM files;')
    await client.query(`INSERT INTO photo_albums (id, owner, name, updated_at) VALUES
        ('album-old','owner-test','Older album','2026-01-01'),
        ('album-new','owner-test','Newer album','2026-02-01');
        INSERT INTO photo_album_members (album_id,user_id,role) VALUES
        ('album-old','viewer-test','viewer'), ('album-old','contributor-test','contributor'),
        ('album-new','viewer-test','viewer');
        INSERT INTO files (id,name,type,owner,data) VALUES
        ('photo-owner','photo.jpg','image/jpeg','owner-test',decode('01020304','hex')),
        ('photo-contributor','shared.jpg','image/jpeg','contributor-test',decode('05060708','hex'));
        INSERT INTO photo_album_items (album_id,file_id,added_by) VALUES
        ('album-old','photo-owner','owner-test'), ('album-old','photo-contributor','contributor-test');`)
})

afterAll(async () => {
    globalThis.fetch = originalFetch
    await app.close()
    if (connected) {
        try { await client.query('ROLLBACK') } finally { await client.end() }
    }
})

describe('album actions with isolated PostgreSQL', () => {
    test('pinning an album deleted after the access check returns not found', async () => {
        deleteAlbumBeforePinInsert = true
        const response = await pin('owner-test', true)
        expect(response.statusCode).toBe(404)
        expect(response.json()).toEqual({ error: 'Album not found.' })
        expect(deleteAlbumBeforePinInsert).toBe(false)
        expect((await client.query('SELECT * FROM photo_album_pins')).rowCount).toBe(0)
        expect((await albums('owner-test')).map(row => row.id)).toEqual(['album-new'])
    })

    test('pins persist per user, sort first, remain idempotent, and unpin independently', async () => {
        expect((await albums('owner-test')).map(row => row.id)).toEqual(['album-new', 'album-old'])
        const before = (await client.query("SELECT updated_at FROM photo_albums WHERE id='album-old'")).rows[0]
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await pin('owner-test', true)
            expect(response.statusCode).toBe(200)
            expect(response.json()).toEqual({ id: 'album-old', is_pinned: true })
            expect(response.headers['cache-control']).toBe('private, no-store')
        }
        expect((await client.query('SELECT * FROM photo_album_pins')).rowCount).toBe(1)
        expect((await albums('owner-test')).map(row => [row.id, row.is_pinned, row.photo_count]))
            .toEqual([['album-old', true, 2], ['album-new', false, 0]])
        expect((await albums('viewer-test')).map(row => [row.id, row.is_pinned]))
            .toEqual([['album-new', false], ['album-old', false]])
        expect((await pin('viewer-test', true)).statusCode).toBe(200)
        expect((await pin('owner-test', false)).json()).toEqual({ id: 'album-old', is_pinned: false })
        expect((await pin('owner-test', false)).statusCode).toBe(200)
        expect((await albums('owner-test'))[0].id).toBe('album-new')
        expect((await albums('viewer-test'))[0]).toMatchObject({ id: 'album-old', is_pinned: true })
        expect((await client.query("SELECT updated_at FROM photo_albums WHERE id='album-old'")).rows[0]).toEqual(before)
    })

    test('viewers and contributors can pin only while they have album access', async () => {
        for (const user of ['viewer-test', 'contributor-test']) {
            expect((await pin(user, true)).statusCode).toBe(200)
            expect((await albums(user)).find(row => row.id === 'album-old')?.is_pinned).toBe(true)
            const removed = await app.inject({ method: 'DELETE', url: `/api/albums/album-old/members/${user}`,
                headers: headers() })
            expect(removed.statusCode).toBe(200)
            expect((await albums(user)).some(row => row.id === 'album-old')).toBe(false)
            expect((await pin(user, true)).statusCode).toBe(404)
            expect((await pin(user, false)).statusCode).toBe(404)
        }
    })

    test('unauthorized and cross-origin requests cannot view or change album pins', async () => {
        await client.query("UPDATE photo_albums SET public_token='synthetic-public-token' WHERE id='album-old'")
        expect(await albums('outsider-test')).toEqual([])
        for (const id of ['album-old', 'missing-album']) {
            const response = await pin('outsider-test', true, id)
            expect(response.statusCode).toBe(404)
            expect(response.json()).toEqual({ error: 'Album not found.' })
            const album = await app.inject({ method: 'GET', url: `/api/albums/${id}`, headers: headers('outsider-test') })
            expect(album.statusCode).toBe(404)
        }
        for (const user of ['', 'invalid-session']) expect((await pin(user, true)).statusCode).toBe(401)
        for (const origin of [null, 'https://attacker.example', 'http://cdn.test.attacker.example']) {
            expect((await pin('owner-test', true, 'album-old', origin)).statusCode).toBe(403)
        }
        expect((await client.query('SELECT * FROM photo_album_pins')).rowCount).toBe(0)
    })

    test('pin input must be a boolean and an unavailable Identity service cannot change it', async () => {
        for (const value of ['true', 1, null, {}, []]) expect((await pin('owner-test', value)).statusCode).toBe(400)
        const missing = await app.inject({ method: 'PUT', url: '/api/albums/album-old/pin', headers: headers(), payload: {} })
        expect(missing.statusCode).toBe(400)
        globalThis.fetch = (async () => { throw new Error('Synthetic Identity outage') }) as typeof fetch
        expect((await pin('owner-test', true)).statusCode).toBe(503)
        expect((await client.query('SELECT * FROM photo_album_pins')).rowCount).toBe(0)
    })

    test('only the owner can rename, enable public sharing, invite people, or delete the album', async () => {
        for (const user of ['viewer-test', 'contributor-test', 'outsider-test']) {
            for (const payload of [{ name: 'Not allowed' }, { isPublic: true }]) {
                const response = await app.inject({ method: 'PATCH', url: '/api/albums/album-old', headers: headers(user), payload })
                expect(response.statusCode).toBe(403)
            }
            const invite = await app.inject({ method: 'POST', url: '/api/albums/album-old/members', headers: headers(user),
                payload: { userId: 'new-member', role: 'contributor' } })
            expect(invite.statusCode).toBe(403)
            const remove = await app.inject({ method: 'DELETE', url: '/api/albums/album-old/members/other-member', headers: headers(user) })
            expect(remove.statusCode).toBe(403)
            const deletion = await app.inject({ method: 'DELETE', url: '/api/albums/album-old', headers: headers(user) })
            expect(deletion.statusCode).toBe(404)
        }
        const renamed = await app.inject({ method: 'PATCH', url: '/api/albums/album-old', headers: headers(),
            payload: { name: '  Family photos  ', isPublic: true } })
        expect(renamed.statusCode).toBe(200)
        expect(renamed.json()).toMatchObject({ name: 'Family photos', is_public: true })
        const token = renamed.json().public_token
        expect(typeof token).toBe('string')
        const ownerAlbum = await app.inject({ method: 'GET', url: '/api/albums/album-old', headers: headers() })
        expect(ownerAlbum.json().public_token).toBe(token)
        for (const user of ['viewer-test', 'contributor-test']) {
            const memberAlbum = await app.inject({ method: 'GET', url: '/api/albums/album-old', headers: headers(user) })
            expect(memberAlbum.statusCode).toBe(200)
            expect(memberAlbum.json()).not.toHaveProperty('public_token')
        }
        const invite = await app.inject({ method: 'POST', url: '/api/albums/album-old/members', headers: headers(),
            payload: { userId: 'new-member', role: 'contributor' } })
        expect(invite.statusCode).toBe(201)
        expect(invite.json()).toMatchObject({ user_id: 'new-member', role: 'contributor' })
        const disabled = await app.inject({ method: 'PATCH', url: '/api/albums/album-old', headers: headers(), payload: { isPublic: false } })
        expect(disabled.json()).toMatchObject({ is_public: false, public_token: null })
    })

    test('deleting an album clears memberships and personal pins but preserves all original files', async () => {
        const before = (await client.query('SELECT * FROM files ORDER BY id')).rows
        await pin('owner-test', true)
        await pin('viewer-test', true)
        const response = await app.inject({ method: 'DELETE', url: '/api/albums/album-old', headers: headers() })
        expect(response.statusCode).toBe(200)
        expect(response.json()).toEqual({ deleted: 'album-old' })
        for (const table of ['photo_albums', 'photo_album_items', 'photo_album_members', 'photo_album_pins']) {
            const column = table === 'photo_albums' ? 'id' : 'album_id'
            expect((await client.query(`SELECT * FROM ${table} WHERE ${column}=$1`, ['album-old'])).rowCount).toBe(0)
        }
        expect((await client.query('SELECT * FROM files ORDER BY id')).rows).toEqual(before)
        expect((await albums('owner-test')).map(row => row.id)).toEqual(['album-new'])
    })
})
