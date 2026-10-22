import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import { persistFile, maxFileBytes, StorageError } from '#utils/fileStorage.ts'
import { beginGuestUpload, beginUpload } from '#utils/uploadGuard.ts'
import { getSessionUserId } from '#utils/auth/session.ts'
import { readPhotoMetadata } from '#utils/photoMetadata.ts'
import { createPhotoThumbnail } from '#utils/photoThumbnail.ts'

export default async function postFile(req: FastifyRequest, res: FastifyReply) {
    const user = typeof req.headers.id === 'string' ? req.headers.id : ''
    const token = req.headers.authorization?.split(' ')[1] || ''
    const userId = user && token
        ? (await tokenWrapper(user, token, req)).id
        : await getSessionUserId(req)
    if (!req.isMultipart()) return res.status(400).send({ error: 'Request is not multipart' })
    let finish: (() => void) | undefined
    let owner = userId || ''
    try {
        if (userId) finish = beginUpload(userId)
        else {
            const guestUpload = beginGuestUpload(req.ip)
            owner = guestUpload.owner
            finish = guestUpload.finish
        }
        const fields: Record<string, string> = {}
        let data: Buffer | undefined
        for await (const part of req.parts({ limits: { fileSize: maxFileBytes, files: 1, fields: 4, parts: 5 } })) {
            if (part.type === 'file') data = await part.toBuffer()
            else if (['name', 'description', 'path', 'type'].includes(part.fieldname)) fields[part.fieldname] = String(part.value)
        }
        if (!fields.name || !data) return res.status(400).send({ error: 'Missing name or file.' })
        if (fields.name.length > 255 || /[\r\n\0]/.test(fields.name)) return res.status(400).send({ error: 'Invalid file name.' })
        if ((fields.description?.length || 0) > 1024) return res.status(400).send({ error: 'Description is too long.' })
        if ((fields.path?.length || 0) > 180 || /[\r\n\0]/.test(fields.path || '')) {
            return res.status(400).send({ error: 'Invalid file path.' })
        }
        const type = fields.type || 'application/octet-stream'
        if (type.length > 120 || !/^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w=.+-]+)*$/.test(type)) {
            return res.status(400).send({ error: 'Invalid file type.' })
        }
        const id = randomUUID()
        const path = userId ? fields.path || id : id
        const metadata = readPhotoMetadata(data, type)
        const thumbnail = await createPhotoThumbnail(data, type)
        await persistFile(owner, data, async (client, key, thumbnailKey, thumbnailSize) => {
            await client.query(`INSERT INTO files
                (id,name,description,data,path,type,owner,storage_key,storage_size,thumbnail_storage_key,thumbnail_size,thumbnail_processed,
                 photo_taken_at,photo_taken_offset_minutes,location_label,latitude,longitude)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [id, fields.name, fields.description || null, Buffer.alloc(0), path, type, owner, key, data!.length,
                thumbnailKey || null, thumbnailSize || null, true,
                metadata.photoTakenAt, metadata.photoTakenOffsetMinutes, metadata.locationLabel,
                metadata.latitude, metadata.longitude])
        }, undefined, thumbnail)
        return res.send({ id, path, owner: userId || null })
    } catch (error) {
        const e = error as Error & { statusCode?: number, code?: string }
        if (e.code === '23505') return res.status(409).send({ error: 'That file path is already taken.' })
        if (error instanceof StorageError && error.statusCode === 429) {
            return res.header('Retry-After', '1').status(error.statusCode).send({ error: error.message })
        }
        if (error instanceof StorageError || e.statusCode === 413) return res.status(e.statusCode || 413).send({ error: e.message })
        req.log.error({ error }, 'Upload failed')
        return res.status(500).send({ error: 'Upload failed.' })
    } finally { finish?.() }
}
