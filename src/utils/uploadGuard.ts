import { StorageError } from './fileStorage.ts'

const normalUploadTimes = new Map<string, number>()
const bulkBuckets = new Map<string, { tokens: number, updatedAt: number }>()
const maxBulkFilesPerSecond = 5000
const bulkRefillPerMs = maxBulkFilesPerSecond / 1000
let active = 0

export const maxBulkFiles = maxBulkFilesPerSecond
export const maxBulkBytes = 45 * 1024 * 1024

type UploadOptions = {
    fileCount?: number
    mode?: 'single' | 'bulk'
    now?: number
}

function cleanExpired(now: number) {
    for (const [owner, time] of normalUploadTimes) {
        if (time + 1000 <= now) normalUploadTimes.delete(owner)
    }
    for (const [owner, bucket] of bulkBuckets) {
        if (bucket.updatedAt + 1000 <= now) bulkBuckets.delete(owner)
    }
}

/** Reserve one standard upload, or a bounded number of files from an authenticated bulk request. */
export function beginUpload(owner: string, options: UploadOptions = {}) {
    const { fileCount = 1, mode = 'single', now = Date.now() } = options
    const bulk = mode === 'bulk'
    cleanExpired(now)
    if (!owner) throw new StorageError(401, 'Sign in to upload files.')
    if (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > (bulk ? maxBulkFiles : 1)) {
        throw new StorageError(400, 'Invalid upload size.')
    }
    if (active >= 4) throw new StorageError(503, 'Uploads are busy. Try again shortly.')

    if (!bulk) {
        const lastUpload = normalUploadTimes.get(owner)
        if (lastUpload !== undefined && now - lastUpload < 1000) {
            throw new StorageError(429, 'Upload limit reached. Wait a second before uploading again.')
        }
        if (normalUploadTimes.size >= 10000 && !normalUploadTimes.has(owner)) {
            throw new StorageError(503, 'Uploads are busy. Try again shortly.')
        }
        normalUploadTimes.set(owner, now)
    } else {
        if (bulkBuckets.size >= 10000 && !bulkBuckets.has(owner)) {
            throw new StorageError(503, 'Uploads are busy. Try again shortly.')
        }
        const bucket = bulkBuckets.get(owner) || { tokens: maxBulkFilesPerSecond, updatedAt: now }
        bucket.tokens = Math.min(maxBulkFilesPerSecond, bucket.tokens + Math.max(0, now - bucket.updatedAt) * bulkRefillPerMs)
        bucket.updatedAt = now
        if (bucket.tokens < fileCount) {
            bulkBuckets.set(owner, bucket)
            throw new StorageError(429, 'Bulk upload limit reached. Wait before uploading more files.')
        }
        bucket.tokens -= fileCount
        bulkBuckets.set(owner, bucket)
    }

    active++
    let finished = false
    return () => {
        if (finished) return
        active--
        finished = true
    }
}
