import { readFile } from 'node:fs/promises'
import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { sendFileBody, markThumbnailProcessed, storagePath, storeThumbnail } from '#utils/fileStorage.ts'
import { fileResponseHeaders } from '#utils/fileResponse.ts'
import { getSessionUserId } from '#utils/auth/session.ts'
import { createPhotoThumbnail } from '#utils/photoThumbnail.ts'
import { isVideo, requestVideoMedia } from '#utils/videoMedia.ts'

type FileRecord = {
    id: string
    data: Buffer
    storage_key: string | null
    thumbnail_storage_key: string | null
    thumbnail_processed: boolean
    type: string
    name: string
    playback_storage_key: string | null
    owner: string
    restore_private: boolean
    deleted_at: Date | null
    in_private_album: boolean
    in_public_album: boolean
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
                if (thumbnail) await storeThumbnail(file.id, thumbnail, file.storage_key)
                else await markThumbnailProcessed(file.id, file.storage_key)
            } catch {
                await markThumbnailProcessed(file.id, file.storage_key).catch(() => {})
            }
            const result = await run('SELECT thumbnail_storage_key FROM files WHERE id=$1', [file.id])
            return result.rows[0]?.thumbnail_storage_key || null
        })().finally(() => thumbnailJobs.delete(file.id))
        thumbnailJobs.set(file.id, job)
    }
    return job
}

export default async function getFile(req: FastifyRequest, res: FastifyReply) {
    return getFileByIdentifier(req, res, 'id')
}

export async function getFileByIdentifier(req: FastifyRequest, res: FastifyReply, identifier: 'id' | 'path') {
    const { id } = req.params as { id: string }
    const query = req.query as { variant?: string, trash?: string }
    const variant = query.variant
    const trashThumbnail = query.trash === '1' && variant === 'thumbnail'

    try {
        const result = await run(`SELECT f.id, f.name, f.description, f.data, f.storage_key, f.thumbnail_storage_key,
            f.thumbnail_processed,f.playback_storage_key,f.owner,f.restore_private,f.deleted_at,f.type, f.path, f.uploaded_at,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NULL) AS in_private_album,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NOT NULL) AS in_public_album
            FROM files f WHERE f.${identifier}=$1 AND f.purge_started_at IS NULL
                AND (f.deleted_at IS NULL OR ($2::boolean AND f.deleted_at > NOW() - INTERVAL '30 days'))`, [id, trashThumbnail])

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        const file = result.rows[0] as FileRecord
        if (file.deleted_at) {
            const userId = await getSessionUserId(req)
            if (!trashThumbnail || !userId || file.owner !== userId || !file.thumbnail_storage_key) {
                return res.status(404).send({ error: 'File not found' })
            }
            res.headers(fileResponseHeaders(file.name, 'image/webp')).header('Cache-Control', 'private, no-store')
            return await sendFileBody(req, res, { ...file, storage_key: file.thumbnail_storage_key })
        }
        const privateFile = file.restore_private || (file.in_private_album && !file.in_public_album)
        if (privateFile) {
            const userId = await getSessionUserId(req)
            const access = userId && file.owner !== userId ? await run(`SELECT EXISTS(SELECT 1 FROM photo_album_items i
                JOIN photo_albums a ON a.id=i.album_id LEFT JOIN photo_album_members m
                ON m.album_id=a.id AND m.user_id=$2
                WHERE i.file_id=$1 AND a.public_token IS NULL AND (a.owner=$2 OR m.user_id=$2)) AS allowed`, [file.id, userId]) : null
            if (!userId || (file.owner !== userId && !access?.rows[0]?.allowed)) {
                return res.status(404).send({ error: 'File not found' })
            }
        }
        let key: string | null = null
        let type = file.type
        if (isVideo(file.type) && (variant === 'thumbnail' || variant === 'playback')) {
            key = variant === 'thumbnail' ? file.thumbnail_storage_key : file.playback_storage_key
            type = variant === 'thumbnail' ? 'image/webp' : 'video/mp4'
            if (!key) {
                const state = requestVideoMedia(file, variant, req.log)
                return res.status(state === 'pending' ? 202 : 503)
                    .header('Cache-Control', 'private, no-store')
                    .header('X-Media-State', state)
                    .header('Retry-After', state === 'pending' ? '2' : state === 'busy' ? '5' : '60')
                    .send({ status: state, message: state === 'failed'
                        ? 'The video preview could not be prepared. You can still download the original.'
                        : 'Preparing video preview.' })
            }
        } else if (variant === 'playback') {
            return res.status(400).send({ error: 'Playback previews are available for videos only.' })
        } else if (variant === 'thumbnail') {
            key = await ensureThumbnail(file as FileRecord)
            if (key) type = 'image/webp'
        }
        // A derivative may have taken time to create. Do not serve a file trashed during that work.
        if (variant === 'thumbnail' && !isVideo(file.type)) {
            const active = await run('SELECT id FROM files WHERE id=$1 AND deleted_at IS NULL AND purge_started_at IS NULL', [file.id])
            if (!active.rowCount) return res.status(404).send({ error: 'File not found' })
        }
        res.headers(fileResponseHeaders(file.name, type))
        if (privateFile || file.in_private_album || file.restore_private) res.header('Cache-Control', 'private, no-store')
        return await sendFileBody(req, res, key ? { ...file, storage_key: key } : file)
    } catch (error) {
        req.log.error({ error }, 'File read failed')
        res.status(500).send({ error: 'Internal server error' })
    }
}
