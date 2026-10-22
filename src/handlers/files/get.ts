import { readFile } from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { fileBody, markThumbnailProcessed, storagePath, storeThumbnail } from '#utils/fileStorage.ts'
import { fileResponseHeaders } from '#utils/fileResponse.ts'
import { getSessionUserId } from '#utils/auth/session.ts'
import { createPhotoThumbnail } from '#utils/photoThumbnail.ts'

type FileRecord = {
    id: string
    data: Buffer
    storage_key: string | null
    thumbnail_storage_key: string | null
    thumbnail_processed: boolean
    type: string
}

const thumbnailJobs = new Map<string, Promise<string | null>>()

async function ensureThumbnail(file: FileRecord): Promise<string | null> {
    if (file.thumbnail_storage_key) return file.thumbnail_storage_key
    if (file.thumbnail_processed) return null

    let job = thumbnailJobs.get(file.id)
    if (!job) {
        job = (async () => {
            try {
                const data = file.storage_key ? await readFile(storagePath(file.storage_key)) : file.data
                const thumbnail = await createPhotoThumbnail(data, file.type)
                if (thumbnail) await storeThumbnail(file.id, thumbnail)
                else await markThumbnailProcessed(file.id)
            } catch {
                await markThumbnailProcessed(file.id).catch(() => {})
            }
            const result = await run('SELECT thumbnail_storage_key FROM files WHERE id=$1', [file.id])
            return result.rows[0]?.thumbnail_storage_key || null
        })().finally(() => thumbnailJobs.delete(file.id))
        thumbnailJobs.set(file.id, job)
    }
    return job
}

export default async function getFile(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    const variant = (req.query as { variant?: string }).variant

    try {
        const result = await run(`SELECT f.id, f.name, f.description, f.data, f.storage_key, f.thumbnail_storage_key,
            f.thumbnail_processed,f.type, f.path, f.uploaded_at,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NULL) AS in_private_album,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NOT NULL) AS in_public_album
            FROM files f WHERE f.id=$1`, [id])

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        const file = result.rows[0]
        if (file.in_private_album && !file.in_public_album) {
            const userId = await getSessionUserId(req)
            const access = userId ? await run(`SELECT EXISTS(SELECT 1 FROM photo_album_items i
                JOIN photo_albums a ON a.id=i.album_id LEFT JOIN photo_album_members m
                ON m.album_id=a.id AND m.user_id=$2
                WHERE i.file_id=$1 AND (a.owner=$2 OR m.user_id=$2)) AS allowed`, [id, userId]) : null
            if (!access?.rows[0]?.allowed) return res.status(404).send({ error: 'File not found' })
        }
        const thumbnailKey = variant === 'thumbnail' ? await ensureThumbnail(file as FileRecord) : null
        const responseFile = thumbnailKey
            ? { ...file, storage_key: thumbnailKey, type: 'image/webp' }
            : file
        res.headers(fileResponseHeaders(file.name, responseFile.type))
        if (file.in_private_album) res.header('Cache-Control', 'private, no-store')
        return res.send(fileBody(responseFile as { storage_key?: string, data: Buffer }))
    } catch (error) {
        req.log.error({ error }, 'File read failed')
        res.status(500).send({ error: 'Internal server error' })
    }
}
