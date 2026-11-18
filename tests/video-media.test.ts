import { afterAll, beforeAll, expect, mock, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Fastify, { type FastifyRequest } from 'fastify'

// Run alone: all database/auth calls are synthetic. No application .env is loaded.
const directory = await mkdtemp(join(tmpdir(), 'cdn-video-test-'))
process.env.CDN_STORAGE_DIR = directory
process.env.CDN_MIN_FREE_BYTES = '1'
const rows = new Map<string, Record<string, unknown>>()
const queries: string[] = []
let generationReads = 0
let failAttach = false
let generationGate: Promise<void> | null = null
async function query(sql: string, values: unknown[] = []) {
    queries.push(sql)
    const row = rows.get(String(values[0])) || [...rows.values()].find(file => file.path === values[0])
    const result = (data: unknown[]) => ({ rows: data, rowCount: data.length })
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql) || sql.includes('pg_advisory_xact_lock')) return result([])
    if (sql.includes('AS used FROM files')) return result([{ used: '0' }])
    if (sql.includes('SELECT id,type,data,storage_key')) {
        generationReads++
        if (String(values[0]).startsWith('bound-')) { await generationGate; return result([]) }
        return result(row && !row.deleted_at && !row.purge_started_at ? [{ ...row }] : [])
    }
    if (sql.includes('FOR UPDATE')) return result(row && !row.deleted_at && !row.purge_started_at
        && row.storage_key === values[1] ? [{ ...row }] : [])
    if (sql.includes('UPDATE files SET')) {
        if (failAttach) throw Error('Synthetic database write failure')
        if (!row) throw Error('Synthetic file is missing')
        const variant = sql.includes('SET playback') ? 'playback' : 'thumbnail'
        row[`${variant}_storage_key`] = values[1]
        row[`${variant}_size`] = values[2]
        return result([row])
    }
    if (sql.includes('AS allowed')) return result([{ allowed: values[1] === 'member' }])
    if (sql.includes('FROM files f WHERE')) return result(row && !row.purge_started_at
        && (!row.deleted_at || values[1]) ? [{ ...row }] : [])
    throw Error(`Unexpected synthetic SQL: ${sql}`)
}
mock.module('#constants', () => ({ default: {} }))
mock.module('#db', () => ({ default: query }))
mock.module('../src/utils/db/pool.ts', () => ({ default: {
    query, connect: async () => ({ query, release() {} }),
} }))
mock.module('#utils/auth/session.ts', () => ({ getSessionUserId: async (req: FastifyRequest) => req.headers['x-user'] || null }))
const { createVideoDerivative, probeVideo } = await import('../src/utils/videoMedia.ts')
const { sendFileBody, storagePath, storeVideoDerivative } = await import('../src/utils/fileStorage.ts')
const { default: getFile } = await import('../src/handlers/files/get.ts')
const { default: getFileByPath } = await import('../src/handlers/files/getByPath.ts')
const app = Fastify()
app.get('/files/:id', getFile)
app.get('/paths/:id', getFileByPath)
const bytes = Buffer.from('0123456789abcdef')
app.get('/buffer', async (req, res) => sendFileBody(req, res, { data: bytes }))
let source: string
let sourceHash: string
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const execute = promisify(execFile)

beforeAll(async () => {
    source = join(directory, 'synthetic.mov')
    await execute('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '1.2', '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-f', 'mov', source])
    sourceHash = hash(await readFile(source))
    await app.ready()
})
afterAll(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
})

test('synthetic MOV gets a complete H.264/AAC MP4 and WebP poster; original is unchanged', async () => {
    const playback = join(directory, 'test.mp4')
    const poster = join(directory, 'test.webp')
    await createVideoDerivative(source, playback, 'playback')
    await createVideoDerivative(source, poster, 'thumbnail')
    const info = await probeVideo(playback)
    expect(info.stream.codec_name).toBe('h264')
    expect(info.stream.pix_fmt).toBe('yuv420p')
    expect(info.stream.width).toBe(160)
    expect(info.streams.find((item: { codec_type: string, codec_name: string }) => item.codec_type === 'audio').codec_name).toBe('aac')
    expect(Math.abs(info.duration - 1.2)).toBeLessThan(0.2)
    const mp4 = await readFile(playback)
    expect(mp4.indexOf(Buffer.from('moov'))).toBeLessThan(mp4.indexOf(Buffer.from('mdat')))
    expect((await readFile(poster)).subarray(8, 12).toString()).toBe('WEBP')
    expect(hash(await readFile(source))).toBe(sourceHash)
}, 30_000)

test('single ranges, suffix/open-ended ranges, unsatisfiable ranges and HEAD have correct wire semantics', async () => {
    for (const [range, status, body, contentRange] of [
        ['bytes=2-5', 206, '2345', 'bytes 2-5/16'], ['bytes=12-', 206, 'cdef', 'bytes 12-15/16'],
        ['bytes=-4', 206, 'cdef', 'bytes 12-15/16'], ['bytes=14-99', 206, 'ef', 'bytes 14-15/16'],
        ['bytes=20-', 416, '', 'bytes */16'], ['bytes=-0', 416, '', 'bytes */16'],
        ['bytes=1-2,4-5', 200, bytes.toString(), undefined], ['items=1-2', 200, bytes.toString(), undefined],
        ['bytes=7-2', 200, bytes.toString(), undefined],
    ] as const) {
        const response = await app.inject({ url: '/buffer', headers: { range } })
        expect(response.statusCode).toBe(status)
        expect(response.body).toBe(body)
        expect(response.headers['content-range']).toBe(contentRange)
        expect(response.headers['content-length']).toBe(String(body.length))
    }
    const head = await app.inject({ method: 'HEAD', url: '/buffer', headers: { range: 'bytes=2-5' } })
    expect(head.statusCode).toBe(200)
    expect(head.body).toBe('')
    expect(head.headers['content-length']).toBe('16')
    expect(head.headers['content-range']).toBeUndefined()
    const ifRange = await app.inject({ url: '/buffer', headers: { range: 'bytes=2-5', 'if-range': '"unknown"' } })
    expect(ifRange.statusCode).toBe(200)
    expect(ifRange.body).toBe(bytes.toString())
})

test('private originals and derivatives enforce the same access before disk reads on both URLs', async () => {
    const key = randomUUID()
    await writeFile(storagePath(key), bytes)
    rows.set('private', { id: 'private', path: 'private-path', name: 'private.mov', type: 'video/quicktime',
        owner: 'owner', in_private_album: true, in_public_album: false, data: Buffer.alloc(0),
        storage_key: key, thumbnail_storage_key: key, playback_storage_key: key })
    for (const url of ['/files/private', '/paths/private-path']) {
        for (const variant of ['', '?variant=playback', '?variant=thumbnail']) {
            for (const user of ['', 'stranger']) {
                expect((await app.inject({ url: url + variant, headers: { 'x-user': user } })).statusCode).toBe(404)
            }
            for (const user of ['owner', 'member']) {
                const response = await app.inject({ url: url + variant, headers: { 'x-user': user, range: 'bytes=1-3' } })
                expect(response.statusCode).toBe(206)
                expect(response.body).toBe('123')
                expect(response.headers['cache-control']).toBe('private, no-store')
                const head = await app.inject({ method: 'HEAD', url: url + variant, headers: { 'x-user': user } })
                expect(head.body).toBe('')
                expect(head.headers['content-length']).toBe('16')
            }
        }
    }
    expect(generationReads).toBe(0)
})

test('trashed files expose only an existing thumbnail to their owner; restored-private files stay private', async () => {
    const row = rows.get('private')!
    row.deleted_at = new Date()
    for (const url of ['/files/private', '/paths/private-path']) {
        for (const variant of ['', '?variant=playback', '?variant=thumbnail', '?variant=playback&trash=1']) {
            expect((await app.inject({ url: url + variant, headers: { 'x-user': 'owner' } })).statusCode).toBe(404)
        }
        const thumbnail = url + '?variant=thumbnail&trash=1'
        expect((await app.inject({ url: thumbnail, headers: { 'x-user': 'member' } })).statusCode).toBe(404)
        const owner = await app.inject({ url: thumbnail, headers: { 'x-user': 'owner' } })
        expect(owner.statusCode).toBe(200)
        expect(owner.headers['cache-control']).toBe('private, no-store')
        row.purge_started_at = new Date()
        expect((await app.inject({ url: thumbnail, headers: { 'x-user': 'owner' } })).statusCode).toBe(404)
        row.purge_started_at = null
    }
    row.deleted_at = null
    row.in_private_album = false
    row.restore_private = true
    expect((await app.inject('/files/private?variant=playback')).statusCode).toBe(404)
    expect((await app.inject({ url: '/files/private?variant=playback', headers: { 'x-user': 'owner' } })).statusCode).toBe(200)
    expect(generationReads).toBe(0)
})

test('background job responds promptly, reuses cached derivatives and preserves its source', async () => {
    const key = randomUUID()
    await writeFile(storagePath(key), await readFile(source))
    rows.set('queued', { id: 'queued', path: 'queued-path', name: 'queued.mov', type: 'video/quicktime',
        owner: 'owner', in_private_album: true, data: Buffer.alloc(0), storage_key: key })
    expect((await app.inject('/files/queued?variant=playback')).statusCode).toBe(404)
    expect(generationReads).toBe(0)
    const first = await app.inject({ method: 'HEAD', url: '/files/queued?variant=playback', headers: { 'x-user': 'owner' } })
    expect(first.statusCode).toBe(202)
    expect(first.headers['retry-after']).toBe('2')
    expect(first.body).toBe('')
    const deadline = Date.now() + 20_000
    while (!rows.get('queued')!.playback_storage_key && Date.now() < deadline) await Bun.sleep(50)
    const row = rows.get('queued')!
    expect(row.playback_storage_key).toBeTruthy()
    expect(row.thumbnail_storage_key).toBeTruthy()
    const reads = generationReads
    const ready = await app.inject({ url: '/files/queued?variant=playback', headers: { 'x-user': 'owner', range: 'bytes=0-31' } })
    expect(ready.statusCode).toBe(206)
    expect(ready.headers['content-type']).toBe('video/mp4')
    expect(ready.rawPayload.length).toBe(32)
    expect(generationReads).toBe(reads)
    expect(hash(await readFile(storagePath(key)))).toBe(sourceHash)
}, 30_000)

test('derivative attachment refuses trashed, purging and replaced sources and removes files on DB failure', async () => {
    const temporary = join(directory, 'attach.webp')
    const sourceKey = randomUUID()
    rows.set('attach', { id: 'attach', storage_key: sourceKey, deleted_at: new Date() })
    await writeFile(temporary, 'synthetic poster')
    expect(await storeVideoDerivative('attach', sourceKey, 'thumbnail', temporary)).toBe(false)
    rows.get('attach')!.deleted_at = null
    rows.get('attach')!.purge_started_at = new Date()
    expect(await storeVideoDerivative('attach', sourceKey, 'thumbnail', temporary)).toBe(false)
    rows.get('attach')!.purge_started_at = null
    expect(await storeVideoDerivative('attach', randomUUID(), 'thumbnail', temporary)).toBe(false)
    const before = await readdir(directory)
    failAttach = true
    try { await expect(storeVideoDerivative('attach', sourceKey, 'thumbnail', temporary)).rejects.toThrow('Synthetic database') }
    finally { failAttach = false }
    expect((await readdir(directory)).sort()).toEqual(before.filter(name => name !== 'attach.webp').sort())
    expect(queries.some(sql => sql.includes('storage_key IS NOT DISTINCT FROM $2')
        && sql.includes('deleted_at IS NULL') && sql.includes('purge_started_at IS NULL') && sql.includes('FOR UPDATE'))).toBe(true)
})


test('queue coalesces duplicate requests and bounds concurrent jobs without retaining source bytes', async () => {
    let release!: () => void
    generationGate = new Promise<void>(resolve => { release = resolve })
    const before = generationReads
    for (let index = 0; index < 17; index++) rows.set(`bound-${index}`, {
        id: `bound-${index}`, name: 'synthetic.mov', type: 'video/quicktime', storage_key: null, data: Buffer.alloc(0),
    })
    try {
        for (let index = 0; index < 16; index++) {
            const response = await app.inject({ method: 'HEAD', url: `/files/bound-${index}?variant=playback` })
            expect(response.statusCode).toBe(202)
        }
        expect((await app.inject('/files/bound-0?variant=thumbnail')).statusCode).toBe(202)
        const overflow = await app.inject('/files/bound-16?variant=playback')
        expect(overflow.statusCode).toBe(503)
        expect(overflow.headers['retry-after']).toBe('5')
        expect(generationReads - before).toBe(1)
    } finally {
        release()
        generationGate = null
        const deadline = Date.now() + 2000
        while (generationReads < before + 16 && Date.now() < deadline) await Bun.sleep(10)
    }
    expect(generationReads - before).toBe(16)
})


test('long native MP4 posters are not rejected by playback conversion duration limits', async () => {
    const longVideo = join(directory, 'long.mp4')
    await execute('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=size=16x16:rate=1', '-frames:v', '2', '-vf', 'setpts=4000*N/TB',
        '-fps_mode', 'passthrough', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longVideo])
    expect((await probeVideo(longVideo)).duration).toBeGreaterThan(3600)
    const poster = join(directory, 'long.webp')
    await createVideoDerivative(longVideo, poster, 'thumbnail')
    expect((await readFile(poster)).subarray(8, 12).toString()).toBe('WEBP')
    await expect(createVideoDerivative(longVideo, join(directory, 'long-converted.mp4'), 'playback'))
        .rejects.toThrow('playback conversion limits')
}, 30_000)

test('full-range iPhone-style MOV is converted to browser-compatible limited-range video', async () => {
    const input = join(directory, 'full-range.mov')
    const output = join(directory, 'full-range.mp4')
    await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10',
        '-t', '1', '-vf', 'scale=in_range=tv:out_range=pc', '-c:v', 'libx264',
        '-pix_fmt', 'yuvj420p', '-color_range', 'pc', input])
    expect((await probeVideo(input)).stream.pix_fmt).toBe('yuvj420p')
    const before = hash(await readFile(input))
    await createVideoDerivative(input, output, 'playback')
    const result = await probeVideo(output)
    expect(result.stream.codec_name).toBe('h264')
    expect(result.stream.pix_fmt).toBe('yuv420p')
    expect(result.stream.color_range).not.toBe('pc')
    expect(hash(await readFile(input))).toBe(before)
}, 30_000)
