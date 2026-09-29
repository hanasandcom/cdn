import { mkdir, statfs, writeFile, unlink } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pool from './db/pool.ts'

export const storageDirectory = process.env.CDN_STORAGE_DIR || '/var/lib/cdn/files'
export const maxFileBytes = 50 * 1024 * 1024
const GiB = 1024 ** 3
export const storageLimit = Number(process.env.CDN_STORAGE_LIMIT_BYTES) || 100 * GiB
const ownerLimit = Number(process.env.CDN_USER_STORAGE_LIMIT_BYTES) || 5 * GiB
const reserveBytes = Number(process.env.CDN_MIN_FREE_BYTES) || 10 * GiB

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
export async function storageStatus() {
    const [disk, result] = await Promise.all([
        statfs(storageDirectory),
        pool.query(`SELECT COALESCE(SUM(storage_size),0)::text AS used,
            COALESCE(SUM(storage_size) FILTER (WHERE uploaded_at > NOW()-INTERVAL '15 minutes'),0)::text AS recent
            FROM files WHERE storage_key IS NOT NULL`),
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
    save: (client: import('pg').PoolClient, key: string) => Promise<void>,
    replacing?: string,
) {
    if (!data.length || data.length > maxFileBytes) throw new StorageError(413, 'Files must be between 1 byte and 50 MiB.')
    const client = await pool.connect()
    const key = randomUUID()
    let written = false
    try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext(\'cdn-file-storage\'))')
        const usage = await client.query(`SELECT
            COALESCE(SUM(storage_size) FILTER (WHERE storage_key IS NOT NULL),0)::text AS total,
            COALESCE(SUM(COALESCE(storage_size,octet_length(data))) FILTER (WHERE owner=$1),0)::text AS owned
            FROM files WHERE id IS DISTINCT FROM $2`, [owner, replacing || null])
        if (Number(usage.rows[0].total) + data.length > storageLimit) throw new StorageError(507, 'Upload storage is full.')
        if (Number(usage.rows[0].owned) + data.length > ownerLimit) {
            throw new StorageError(413, 'Your upload storage limit has been reached.')
        }
        const disk = await statfs(storageDirectory)
        if (disk.bavail * disk.bsize - data.length < reserveBytes) {
            throw new StorageError(507, 'Uploads are paused because disk space is low.')
        }
        await writeFile(storagePath(key), data, { flag: 'wx', mode: 0o600 })
        written = true
        await save(client, key)
        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        if (written) await removeStoredFile(key)
        throw error
    } finally { client.release() }
}
export async function prepareStorage() { await mkdir(storageDirectory, { recursive: true }) }
