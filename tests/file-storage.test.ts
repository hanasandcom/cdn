/* eslint-disable @stylistic/max-len -- Multipart wire fixtures and SQL assertions are kept intact. */
import { afterAll, beforeAll, expect, test } from 'bun:test'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { readFile, readdir } from 'node:fs/promises'
import pool from '../src/utils/db/pool.ts'
import { prepareStorage, storageDirectory, persistFile, storageStatus, storageLimit, StorageError } from '../src/utils/fileStorage.ts'
import postFile from '../src/handlers/files/post.ts'
import postBulkFiles from '../src/handlers/files/postBulk.ts'
import getFile from '../src/handlers/files/get.ts'
import getUserFiles from '../src/handlers/files/getUserFiles.ts'
import deleteFile from '../src/handlers/files/delete.ts'

const app = Fastify()
const originalFetch = globalThis.fetch
beforeAll(async () => {
    if (process.env.DB_HOST !== 'cdn-restore-test-db') throw new Error('Tests require the isolated database.')
    await prepareStorage()
    await pool.query('DROP TABLE IF EXISTS files')
    await pool.query('CREATE TABLE files(id TEXT PRIMARY KEY,name TEXT,description TEXT,data BYTEA NOT NULL,path TEXT UNIQUE,type TEXT,owner TEXT,uploaded_at TIMESTAMPTZ DEFAULT NOW(),storage_key TEXT,storage_size BIGINT)')
    globalThis.fetch = (async (_url, init) => new Response(JSON.stringify({ id: (init?.headers as Record<string,string>)?.Authorization === 'Bearer valid' ? 'owner' : 'other' }), {status:200})) as typeof fetch
    await app.register(multipart)
    app.post('/files', postFile)
    app.post('/files/bulk', postBulkFiles)
    app.get('/files/user/:id', getUserFiles)
    app.get('/files/:id', getFile)
    app.delete('/files/:id', deleteFile)
    await app.ready()
})
afterAll(async () => { globalThis.fetch = originalFetch; await app.close(); await pool.end() })
function upload(body: string, path: string, auth = true, token = 'valid') {
    const boundary = 'cdn-boundary'
    const fields = { name: 'test.txt', type: 'text/plain', path }
    let payload = Object.entries(fields).map(([key,value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('')
    payload += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--${boundary}--\r\n`
    return app.inject({method:'POST',url:'/files',payload,headers:{'content-type':`multipart/form-data; boundary=${boundary}`,...(auth ? {id:'owner',authorization:`Bearer ${token}`} : {})}})
}
function bulkUpload(files: { name: string, body: string }[], auth = true) {
    const boundary = 'cdn-bulk-boundary'
    const payload = files.map(({ name, body }) =>
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: image/jpeg\r\n\r\n${body}\r\n`,
    ).join('') + `--${boundary}--\r\n`
    return app.inject({
        method: 'POST', url: '/files/bulk', payload,
        headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
            'x-cdn-upload-count': String(files.length),
            ...(auth ? { id: 'owner', authorization: 'Bearer valid' } : {}),
        },
    })
}
test('anonymous upload is rejected before data is stored', async () => {
    expect((await upload('anonymous', 'anonymous', false)).statusCode).toBe(401)
    expect((await pool.query('SELECT count(*) FROM files')).rows[0].count).toBe('0')
})
test('upload uses disk, round trips bytes, preserves legacy reads and isolates library ownership', async () => {
    const response = await upload('hello CDN', 'roundtrip')
    expect(response.statusCode).toBe(200)
    const { id } = response.json()
    const row = (await pool.query('SELECT * FROM files WHERE id=$1',[id])).rows[0]
    expect(row.owner).toBe('owner')
    expect(row.data.length).toBe(0)
    expect(await readFile(storageDirectory + '/' + row.storage_key,'utf8')).toBe('hello CDN')
    expect((await app.inject('/files/' + id)).body).toBe('hello CDN')
    expect((await app.inject('/files/user/owner')).statusCode).toBe(401)
    expect((await app.inject({url:'/files/user/owner',headers:{id:'other',authorization:'Bearer wrong'}})).statusCode).toBe(401)
    const list = await app.inject({url:'/files/user/owner?limit=1',headers:{id:'owner',authorization:'Bearer valid'}})
    expect(list.json()[0].id).toBe(id)
    expect(Number(list.json()[0].size_bytes)).toBe(9)
    await pool.query('INSERT INTO files(id,name,data,path,type,owner) VALUES (\'legacy\',\'legacy\',$1,\'legacy\',\'text/plain\',\'owner\')',[Buffer.from('old content')])
    expect((await app.inject('/files/legacy')).body).toBe('old content')
})
test('path collision cleans its disk write without replacing the original', async () => {
    const count = (await readdir(storageDirectory)).length
    expect((await upload('overwrite', 'roundtrip', true, 'other')).statusCode).toBe(409)
    expect((await readdir(storageDirectory)).length).toBe(count)
})
test('bulk upload stores multiple files and returns canonical share URLs', async () => {
    const response = await bulkUpload([
        { name: 'one.jpg', body: 'first image' },
        { name: 'two.jpg', body: 'second image' },
    ])
    expect(response.statusCode).toBe(200)
    const result = response.json()
    expect(result.failed).toEqual([])
    expect(result.uploaded).toHaveLength(2)
    expect(result.uploaded[0].url).toBe('/api/files/' + result.uploaded[0].id)
    expect(result.uploaded[1].url).toBe('/api/files/' + result.uploaded[1].id)
    expect((await app.inject('/files/' + result.uploaded[0].id)).body).toBe('first image')
})
test('bulk upload rejects signed-out visitors before storing data', async () => {
    const response = await bulkUpload([{ name: 'guest.jpg', body: 'guest image' }, { name: 'other.jpg', body: 'other image' }], false)
    expect(response.statusCode).toBe(401)
    expect((await pool.query('SELECT count(*) FROM files WHERE name IN (\'guest.jpg\',\'other.jpg\')')).rows[0].count).toBe('0')
})
test('storage pressure warns before capacity and blocks writes at the limit', async () => {
    const id = (await pool.query('SELECT id FROM files WHERE path=\'roundtrip\'')).rows[0].id
    await pool.query('UPDATE files SET storage_size=$2 WHERE id=$1',[id,Math.floor(storageLimit*.85)])
    const status = await storageStatus()
    expect(status.ok).toBe(true)
    expect(status.warnings).toContain('Upload storage is above 80% capacity.')
    await expect(persistFile('different-owner',Buffer.alloc(storageLimit*.2),async () => {})).rejects.toBeInstanceOf(StorageError)
    await pool.query('UPDATE files SET storage_size=9 WHERE id=$1',[id])
})
