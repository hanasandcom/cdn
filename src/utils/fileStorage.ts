import { mkdir, stat, statfs, writeFile, unlink, rename, readdir, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import pool from './db/pool.ts'

export const storageDirectory = process.env.CDN_STORAGE_DIR || '/var/lib/cdn/files'
export const maxFileBytes = 50 * 1024 * 1024
const GiB = 1024 ** 3
export const storageLimit = Number(process.env.CDN_STORAGE_LIMIT_BYTES) || 100 * GiB
const ownerLimit = Number(process.env.CDN_USER_STORAGE_LIMIT_BYTES) || 5 * GiB
export const reserveBytes = Number(process.env.CDN_MIN_FREE_BYTES) || 10 * GiB

export class StorageError extends Error {
    constructor(public statusCode: number, message: string) { super(message) }
}
export function storagePath(key: string) {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid storage key')
    return join(storageDirectory, key)
}
export function fileBody(file: { storage_key?: string, data: Buffer }) {
    return file.storage_key ? createReadStream(storagePath(file.storage_key)) : file.data
}
export async function removeStoredFile(key?: string) {
    if (key) await unlink(storagePath(key)).catch(error => { if (error.code !== 'ENOENT') throw error })
}
export async function removeStoredFiles(keys: Array<string | undefined>) {
    await Promise.all(keys.filter(Boolean).map(key => removeStoredFile(key)))
}
export async function storeThumbnail(fileId: string, data: Buffer, sourceKey: string | null = null) {
    if (!data.length || data.length > 2 * 1024 * 1024) return null
    const disk = await statfs(storageDirectory)
    if (disk.bavail * disk.bsize - data.length < reserveBytes) {
        await markThumbnailProcessed(fileId, sourceKey)
        return null
    }
    const key = randomUUID()
    let written = false
    try {
        await writeFile(storagePath(key), data, { flag: 'wx', mode: 0o600 })
        written = true
        const result = await pool.query(`UPDATE files
            SET thumbnail_storage_key=$2,thumbnail_size=$3,thumbnail_processed=TRUE
            WHERE id=$1 AND thumbnail_storage_key IS NULL AND deleted_at IS NULL AND purge_started_at IS NULL
                AND storage_key IS NOT DISTINCT FROM $4
            RETURNING thumbnail_storage_key,thumbnail_size`, [fileId, key, data.length, sourceKey])
        if (result.rowCount) return { key, size: data.length }
        await removeStoredFile(key)
        return null
    } catch (error) {
        if (written) await removeStoredFile(key).catch(() => {})
        throw error
    }
}
export async function markThumbnailProcessed(fileId: string, sourceKey: string | null = null) {
    await pool.query(`UPDATE files SET thumbnail_processed=TRUE
        WHERE id=$1 AND thumbnail_storage_key IS NULL AND deleted_at IS NULL AND purge_started_at IS NULL
            AND storage_key IS NOT DISTINCT FROM $2`, [fileId, sourceKey])
}
export async function storageStatus() {
    const [disk, result] = await Promise.all([
        statfs(storageDirectory),
        pool.query(`SELECT COALESCE(SUM((CASE WHEN storage_key IS NOT NULL THEN COALESCE(storage_size,octet_length(data)) ELSE 0 END)
            +COALESCE(thumbnail_size,0)+COALESCE(playback_size,0)),0)::text AS used,
            COALESCE(SUM((CASE WHEN storage_key IS NOT NULL THEN COALESCE(storage_size,octet_length(data)) ELSE 0 END)
                +COALESCE(thumbnail_size,0)+COALESCE(playback_size,0))
                FILTER (WHERE uploaded_at > NOW()-INTERVAL '15 minutes'),0)::text AS recent FROM files`),
    ])
    const used = Number(result.rows[0].used)
    const free = disk.bavail * disk.bsize
    const recent = Number(result.rows[0].recent)
    const warnings = []
    if (used >= storageLimit * 0.8) warnings.push('Upload storage is above 80% capacity.')
    if (free < reserveBytes * 2) warnings.push('Upload filesystem has less than 20 GiB free.')
    if (recent >= GiB) warnings.push('More than 1 GiB was uploaded in 15 minutes.')
    // Capacity warnings are degraded operation, not failed health: upload limits
    // are enforced separately by persistFile, while this endpoint checks that
    // the filesystem and database are reachable.
    return { ok: true, usedBytes: used, limitBytes: storageLimit, freeBytes: free, recentBytes: recent, warnings }
}

// Serialize reservations across processes, including replacement uploads.
export async function persistFile(
    owner: string, data: Buffer,
    save: (client: import('pg').PoolClient, key: string, thumbnailKey?: string, thumbnailSize?: number) => Promise<void>,
    replacing?: string,
    thumbnail?: Buffer | null,
) {
    if (!data.length || data.length > maxFileBytes) throw new StorageError(413, 'Files must be between 1 byte and 50 MiB.')
    if (thumbnail && thumbnail.length > 2 * 1024 * 1024) throw new StorageError(413, 'Generated thumbnail is too large.')
    const client = await pool.connect()
    const key = randomUUID()
    const thumbnailKey = thumbnail?.length ? randomUUID() : undefined
    const bytesToWrite = data.length + (thumbnail?.length || 0)
    const written: string[] = []
    try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext(\'cdn-file-storage\'))')
        const usage = await client.query(`SELECT
            COALESCE(SUM((CASE WHEN storage_key IS NOT NULL THEN COALESCE(storage_size,octet_length(data)) ELSE 0 END)
                +COALESCE(thumbnail_size,0)+COALESCE(playback_size,0)),0)::text AS total,
            COALESCE(SUM(COALESCE(storage_size,octet_length(data))+COALESCE(thumbnail_size,0)+COALESCE(playback_size,0))
                FILTER (WHERE owner=$1),0)::text AS owned
            FROM files WHERE id IS DISTINCT FROM $2`, [owner, replacing || null])
        if (Number(usage.rows[0].total) + bytesToWrite > storageLimit) throw new StorageError(507, 'Upload storage is full.')
        if (Number(usage.rows[0].owned) + bytesToWrite > ownerLimit) {
            throw new StorageError(413, 'Your upload storage limit has been reached.')
        }
        const disk = await statfs(storageDirectory)
        if (disk.bavail * disk.bsize - bytesToWrite < reserveBytes) {
            throw new StorageError(507, 'Uploads are paused because disk space is low.')
        }
        await writeFile(storagePath(key), data, { flag: 'wx', mode: 0o600 })
        written.push(key)
        if (thumbnail && thumbnailKey) {
            await writeFile(storagePath(thumbnailKey), thumbnail, { flag: 'wx', mode: 0o600 })
            written.push(thumbnailKey)
        }
        await save(client, key, thumbnailKey, thumbnail?.length)
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        await removeStoredFiles(written).catch(() => {})
        throw error
    } finally { client.release() }
}
export async function prepareStorage() {
    await mkdir(storageDirectory, { recursive: true })
    // Only our abandoned work directories are eligible; original UUID files are untouched.
    for (const entry of await readdir(storageDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^\.video-work-[a-zA-Z0-9]+$/.test(entry.name)) continue
        const path = join(storageDirectory, entry.name)
        if (Date.now() - (await stat(path)).mtimeMs > 24 * 60 * 60 * 1000) {
            await rm(path, { recursive: true, force: true })
        }
    }
}


// Ignore malformed/multipart ranges; serve single byte ranges used by media players.
export function byteRange(value: string | undefined, size: number): { start: number, end: number } | 'unsatisfiable' | null {
    if (!value || !value.startsWith('bytes=')) return null
    const match = /^bytes=(\d*)-(\d*)$/.exec(value)
    if (!match || (!match[1] && !match[2])) return null
    const first = match[1] ? Number(match[1]) : null
    const last = match[2] ? Number(match[2]) : null
    if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null
    if (!size || (first !== null && first >= size) || (first === null && last === 0)) return 'unsatisfiable'
    if (first !== null && last !== null && first > last) return null
    return { start: first === null ? Math.max(0, size - last!) : first,
        end: first === null || last === null ? size - 1 : Math.min(last, size - 1) }
}

export async function sendFileBody(req: FastifyRequest, res: FastifyReply, file: { storage_key?: string | null, data: Buffer }) {
    const path = file.storage_key ? storagePath(file.storage_key) : null
    const size = path ? (await stat(path)).size : file.data.length
    res.header('Accept-Ranges', 'bytes')
    // No strong validator is advertised: If-Range cannot match, and HEAD ignores Range.
    const range = req.method === 'GET' && !req.headers['if-range'] ? byteRange(req.headers.range, size) : null
    if (range === 'unsatisfiable') {
        return res.status(416).header('Content-Range', `bytes */${size}`).header('Content-Length', '0').send()
    }
    if (range) {
        res.status(206).header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        res.header('Content-Length', String(range.end - range.start + 1))
    } else res.header('Content-Length', String(size))
    // Fastify's automatic HEAD hook preserves stream lengths but replaces empty payload lengths.
    if (req.method === 'HEAD') return res.send(Readable.from([]))
    return res.send(path ? createReadStream(path, range || undefined)
        : range ? file.data.subarray(range.start, range.end + 1) : file.data)
}

export async function storeVideoDerivative(
    fileId: string, sourceKey: string | null, variant: 'thumbnail' | 'playback', temporaryPath: string,
) {
    const size = (await stat(temporaryPath)).size
    if (!size || size > (variant === 'thumbnail' ? 2 * 1024 * 1024 : 512 * 1024 * 1024)) {
        throw new StorageError(413, 'The generated video preview is too large.')
    }
    const key = randomUUID()
    const client = await pool.connect()
    let moved = false
    try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext(\'cdn-file-storage\'))')
        const current = await client.query(`SELECT ${variant}_storage_key FROM files
            WHERE id=$1 AND storage_key IS NOT DISTINCT FROM $2 AND deleted_at IS NULL AND purge_started_at IS NULL FOR UPDATE`,
        [fileId, sourceKey])
        if (!current.rowCount || current.rows[0][`${variant}_storage_key`]) {
            await client.query('ROLLBACK')
            return false
        }
        const usage = await client.query(`SELECT COALESCE(SUM(
            (CASE WHEN storage_key IS NOT NULL THEN COALESCE(storage_size,octet_length(data)) ELSE 0 END)
            +COALESCE(thumbnail_size,0)+COALESCE(playback_size,0)),0)::text AS used FROM files`)
        const disk = await statfs(storageDirectory)
        if (Number(usage.rows[0].used) + size > storageLimit || disk.bavail * disk.bsize < reserveBytes) {
            throw new StorageError(507, 'Video previews are paused because storage is full.')
        }
        await rename(temporaryPath, storagePath(key))
        moved = true
        await client.query(`UPDATE files SET ${variant}_storage_key=$2,${variant}_size=$3
            ${variant === 'thumbnail' ? ',thumbnail_processed=TRUE' : ''} WHERE id=$1`, [fileId, key, size])
        await client.query('COMMIT')
        return true
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        if (moved) await removeStoredFile(key).catch(() => {})
        throw error
    } finally { client.release() }
}
