import { basename } from 'node:path'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import { getSessionUserId } from '#utils/auth/session.ts'
import { persistFile, maxFileBytes, StorageError } from '#utils/fileStorage.ts'
import { beginUpload, maxBulkBytes, maxBulkFiles } from '#utils/uploadGuard.ts'
import { readPhotoMetadata } from '#utils/photoMetadata.ts'

type BulkUploadHeaders = { 'x-cdn-upload-count'?: string }

export default async function postBulkFiles(
    req: FastifyRequest<{ Headers: BulkUploadHeaders }>,
    res: FastifyReply,
) {
    const user = typeof req.headers.id === 'string' ? req.headers.id : ''
    const token = req.headers.authorization?.split(' ')[1] || ''
    const userId = user && token
        ? (await tokenWrapper(user, token, req)).id
        : await getSessionUserId(req)
    if (!userId) return res.status(401).send({ error: 'Sign in to upload files.' })
    if (!req.isMultipart()) return res.status(400).send({ error: 'Request is not multipart.' })

    const rawCount = req.headers['x-cdn-upload-count']
    const fileCount = typeof rawCount === 'string' && /^\d{1,4}$/.test(rawCount) ? Number(rawCount) : 0
    if (fileCount < 1 || fileCount > maxBulkFiles) {
        return res.status(400).send({ error: `Choose between 1 and ${maxBulkFiles} files.` })
    }
    const contentLength = Number(req.headers['content-length'])
    if (Number.isFinite(contentLength) && contentLength > 50 * 1024 * 1024) {
        return res.status(413).send({ error: 'Bulk request is larger than the 50 MiB upload limit.' })
    }

    let finish: (() => void) | undefined
    const uploaded: { id: string, name: string, url: string }[] = []
    const failed: { name: string, error: string }[] = []
    let received = 0
    let stopReason = ''
    let totalBytes = 0
    try {
        finish = beginUpload(userId, { fileCount, mode: 'bulk' })
        for await (const part of req.files({
            limits: { fileSize: maxFileBytes, files: maxBulkFiles, fields: 0, parts: maxBulkFiles },
            throwFileSizeLimit: false,
        })) {
            received++
            const safeName = basename(part.filename.replaceAll('\\', '/'))
            if (received > fileCount) {
                part.file.resume()
                failed.push({ name: safeName, error: 'The request contains more files than declared.' })
                continue
            }
            if (part.fieldname !== 'files' || !safeName || safeName.length > 255 || /[\r\n\0]/.test(safeName)) {
                part.file.resume()
                failed.push({ name: safeName || 'Unnamed file', error: 'Invalid file name.' })
                continue
            }
            if (stopReason) {
                part.file.resume()
                failed.push({ name: safeName, error: stopReason })
                continue
            }
            const type = part.mimetype || 'application/octet-stream'
            if (type.length > 120 || !/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(type)) {
                part.file.resume()
                failed.push({ name: safeName, error: 'Invalid file type.' })
                continue
            }
            try {
                const data = await part.toBuffer()
                if (part.file.truncated) {
                    failed.push({ name: safeName, error: 'Files must be 50 MiB or smaller.' })
                    continue
                }
                if (totalBytes + data.length > maxBulkBytes) {
                    stopReason = 'Each bulk request must stay within 45 MiB.'
                    failed.push({ name: safeName, error: stopReason })
                    continue
                }
                totalBytes += data.length
                const id = randomUUID()
                const metadata = readPhotoMetadata(data, type)
                await persistFile(userId, data, async (client, key) => {
                    await client.query(`INSERT INTO files
                        (id,name,description,data,path,type,owner,storage_key,storage_size,photo_taken_at,location_label,latitude,longitude)
                        VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
                    [id, safeName, Buffer.alloc(0), id, type, userId, key, data.length,
                        metadata.photoTakenAt, metadata.locationLabel, metadata.latitude, metadata.longitude])
                })
                uploaded.push({ id, name: safeName, url: `/api/files/${encodeURIComponent(id)}` })
            } catch (error) {
                const e = error as Error & { statusCode?: number, code?: string }
                if (error instanceof StorageError) {
                    failed.push({ name: safeName, error: e.message })
                    if (e.statusCode === 413 || e.statusCode === 507) stopReason = e.message
                } else {
                    req.log.error({ error, userId }, 'Bulk upload file failed')
                    failed.push({ name: safeName, error: 'Upload failed.' })
                }
            }
        }
        if (received !== fileCount) {
            return res.status(400).send({
                error: `The request declared ${fileCount} files but contained ${received}.`, uploaded, failed,
            })
        }
        return res.send({ uploaded, failed })
    } catch (error) {
        const e = error as Error & { statusCode?: number, code?: string }
        if (error instanceof StorageError && error.statusCode === 429) {
            return res.header('Retry-After', '1').status(error.statusCode).send({ error: error.message, uploaded, failed })
        }
        if (error instanceof StorageError || e.statusCode === 413) {
            return res.status(e.statusCode || 413).send({ error: e.message, uploaded, failed })
        }
        req.log.error({ error, userId }, 'Bulk upload failed')
        return res.status(400).send({ error: 'Bulk upload could not be read.', uploaded, failed })
    } finally {
        finish?.()
    }
}
