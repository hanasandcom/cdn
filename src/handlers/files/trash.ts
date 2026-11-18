import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { fileRequestUser } from '#utils/fileTrashAuth.ts'
import { permanentlyDeleteMedia, restoreMedia } from '#utils/fileTrash.ts'

export async function getTrash(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'private, no-store')
    const userId = await fileRequestUser(req, res)
    if (!userId) return
    const query = req.query as { limit?: string, offset?: string, search?: string }
    const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit || '100', 10) || 100))
    const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(query.offset || '0', 10) || 0))
    const search = typeof query.search === 'string' ? query.search.trim().slice(0, 120) : ''
    const result = await run(`SELECT id,name,type,owner,uploaded_at,deleted_at,
        photo_taken_at,photo_taken_offset_minutes,location_label,
        deleted_at + INTERVAL '30 days' AS expires_at,
        COALESCE(storage_size,octet_length(data)) AS size_bytes
        FROM files WHERE owner=$1 AND deleted_at > NOW() - INTERVAL '30 days'
            AND purge_started_at IS NULL
            AND ($4='' OR strpos(lower(name),lower($4))>0
                OR strpos(lower(concat_ws(' ',location_label,latitude::text,longitude::text)),lower($4))>0)
        ORDER BY deleted_at DESC,id LIMIT $2 OFFSET $3`, [userId, limit, offset, search])
    return res.send(result.rows)
}

export async function restoreFile(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'private, no-store')
    const userId = await fileRequestUser(req, res, true)
    if (!userId) return
    const { id } = req.params as { id: string }
    const result = await restoreMedia(id, userId)
    if (!result.rowCount) return res.status(404).send({ error: 'File is not available to restore.' })
    return res.send({ restored: result.rows[0].id })
}

export async function permanentlyDeleteFile(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'private, no-store')
    const userId = await fileRequestUser(req, res, true)
    if (!userId) return
    const { id } = req.params as { id: string }
    try {
        const deleted = await permanentlyDeleteMedia(id, userId)
        if (!deleted) return res.status(404).send({ error: 'File not found in trash.' })
        return res.send({ deleted })
    } catch (error) {
        req.log.error({ error, fileId: id }, 'Permanent file removal failed')
        return res.status(503).send({ error: 'File removal is pending. Please try again.' })
    }
}
