import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { removeStoredFile } from '#utils/fileStorage.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import filePermissionsWrapper from '#utils/auth/filePermissionsWrapper.ts'

export default async function deleteFile(req: FastifyRequest, res: FastifyReply) {
    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { id } = req.params as { id: string }
    if (!id) {
        return res.status(400).send({ error: 'Missing image ID' })
    }

    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const allowed = await filePermissionsWrapper({ userId, fileId: id })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const result = await run(
            'DELETE FROM files WHERE id = $1 RETURNING id, storage_key',
            [id]
        )

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        await removeStoredFile(result.rows[0].storage_key)
        return { deleted: result.rows[0].id }
    } catch (error) {
        console.log('Error deleting image:', error)
        return res.status(500).send({ error: 'Internal server error' })
    }
}
