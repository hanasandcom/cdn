import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { fileBody } from '#utils/fileStorage.ts'
import { fileResponseHeaders } from '#utils/fileResponse.ts'
import { getSessionUserId } from '#utils/auth/session.ts'

export default async function getFileByPath(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }

    try {
        const result = await run(`SELECT f.id, f.name, f.description, f.data, f.storage_key, f.type, f.path, f.uploaded_at,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NULL) AS in_private_album,
            EXISTS(SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
                WHERE i.file_id=f.id AND a.public_token IS NOT NULL) AS in_public_album
            FROM files f WHERE f.path=$1`, [id])

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        const file = result.rows[0]
        if (file.in_private_album && !file.in_public_album) {
            const userId = await getSessionUserId(req)
            const access = userId ? await run(`SELECT EXISTS(SELECT 1 FROM photo_album_items i
                JOIN photo_albums a ON a.id=i.album_id LEFT JOIN photo_album_members m
                ON m.album_id=a.id AND m.user_id=$2
                WHERE i.file_id=$1 AND (a.owner=$2 OR m.user_id=$2)) AS allowed`, [file.id, userId]) : null
            if (!access?.rows[0]?.allowed) return res.status(404).send({ error: 'File not found' })
        }
        res.headers(fileResponseHeaders(file.name, file.type))
        if (file.in_private_album) res.header('Cache-Control', 'private, no-store')
        return res.send(fileBody(file as { storage_key?: string, data: Buffer }))
    } catch (error) {
        req.log.error({ error }, 'File read failed')
        res.status(500).send({ error: 'Internal server error' })
    }
}
