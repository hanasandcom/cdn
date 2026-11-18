import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { removeStoredFiles } from '#utils/fileStorage.ts'
import filePermissionsWrapper from '#utils/auth/filePermissionsWrapper.ts'
import { fileRequestUser } from '#utils/fileTrashAuth.ts'
import { trashMedia } from '#utils/fileTrash.ts'

export default async function deleteFile(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'private, no-store')
    const userId = await fileRequestUser(req, res, true)
    if (!userId) return
    const { id } = req.params as { id: string }
    if (!id) return res.status(400).send({ error: 'Missing file ID' })
    try {
        const current = await run('SELECT type FROM files WHERE id=$1', [id])
        if (!current.rowCount) return res.status(404).send({ error: 'File not found' })
        if (/^(image|video)\//.test(current.rows[0].type)) {
            const result = await trashMedia(id, userId)
            if (!result.rowCount) return res.status(404).send({ error: 'File not found' })
            return res.send({ deleted: id, trashed: true, deleted_at: result.rows[0].deleted_at,
                expires_at: result.rows[0].expires_at })
        }
        const allowed = await filePermissionsWrapper({ userId, fileId: id })
        if (!allowed.status) return res.status(401).send({ error: 'Unauthorized' })
        const result = await run(`DELETE FROM files WHERE id=$1 AND deleted_at IS NULL
            AND type NOT LIKE 'image/%' AND type NOT LIKE 'video/%'
            RETURNING id,storage_key,thumbnail_storage_key,playback_storage_key`, [id])
        if (!result.rowCount) return res.status(404).send({ error: 'File not found' })
        await removeStoredFiles([result.rows[0].storage_key, result.rows[0].thumbnail_storage_key,
            result.rows[0].playback_storage_key])
        return res.send({ deleted: result.rows[0].id })
    } catch (error) {
        req.log.error({ error, fileId: id }, 'File deletion failed')
        return res.status(500).send({ error: 'Internal server error' })
    }
}
