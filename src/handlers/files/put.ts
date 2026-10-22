import type { FastifyReply, FastifyRequest } from 'fastify'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import filePermissionsWrapper from '#utils/auth/filePermissionsWrapper.ts'
import run from '#db'
import { persistFile, removeStoredFiles, StorageError } from '#utils/fileStorage.ts'
import { beginUpload } from '#utils/uploadGuard.ts'
import { readPhotoMetadata } from '#utils/photoMetadata.ts'
import { createPhotoThumbnail } from '#utils/photoThumbnail.ts'

type PutFileProps = {
    name?: string
    description?: string
    data?: string
    path?: string
    type?: string
}

export default async function putFile(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    const { name, description, data, path, type } = req.body as PutFileProps
    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const allowed = await filePermissionsWrapper({ userId, fileId: id })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    if (!name && !description && !data && !path && !type) {
        return res.status(400).send({ error: 'Nothing to update' })
    }

    const updates: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const values: any[] = []
    let index = 1

    if (name) {
        updates.push(`name = $${index++}`)
        values.push(name)
    }

    if (description) {
        updates.push(`description = $${index++}`)
        values.push(description)
    }

    if (data) {
        updates.push(`data = $${index++}`)
        values.push(Buffer.alloc(0))
    }

    if (path) {
        updates.push(`path = $${index++}`)
        values.push(path)
    }

    if (type) {
        updates.push(`type = $${index++}`)
        values.push(type)
    }

    values.push(id)
    const sql = `UPDATE files SET ${updates.join(', ')} WHERE id = $${index} RETURNING id`

    try {
        let result
        if (data) {
            const finish = beginUpload(userId)
            let oldKey: string | undefined
            let oldThumbnailKey: string | undefined
            try {
                const current = await run('SELECT owner,type FROM files WHERE id=$1', [id])
                const buffer = Buffer.from(data, 'base64')
                const fileType = type || current.rows[0]?.type || 'application/octet-stream'
                const metadata = readPhotoMetadata(buffer, fileType)
                const thumbnail = await createPhotoThumbnail(buffer, fileType)
                await persistFile(current.rows[0]?.owner || userId, buffer, async (client, key, thumbnailKey, thumbnailSize) => {
                    const old = await client.query('SELECT storage_key,thumbnail_storage_key FROM files WHERE id=$1 FOR UPDATE', [id])
                    if (!old.rows.length) throw new StorageError(404, 'File not found')
                    oldKey = old.rows[0].storage_key
                    oldThumbnailKey = old.rows[0].thumbnail_storage_key
                    result = await client.query(sql, values)
                    await client.query(`UPDATE files SET storage_key=$2,storage_size=$3,thumbnail_storage_key=$4,
                        thumbnail_size=$5,thumbnail_processed=TRUE,photo_taken_at=$6,photo_taken_offset_minutes=$7,
                        location_label=$8,latitude=$9,longitude=$10 WHERE id=$1`,
                    [id, key, buffer.length, thumbnailKey || null, thumbnailSize || null, metadata.photoTakenAt,
                        metadata.photoTakenOffsetMinutes, metadata.locationLabel, metadata.latitude, metadata.longitude])
                }, id, thumbnail)
                await removeStoredFiles([oldKey, oldThumbnailKey])
            } finally { finish() }
        } else result = await run(sql, values)
        if (!result) throw new Error('File update failed')

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        return { updated: result.rows[0].id }
    } catch (error) {
        if (error instanceof StorageError) return res.status(error.statusCode).send({ error: error.message })
        console.log(error)
        return res.status(500).send({ error: 'Internal server error' })
    }
}
