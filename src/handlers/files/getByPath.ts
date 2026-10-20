import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { fileBody } from '#utils/fileStorage.ts'
import { fileResponseHeaders } from '#utils/fileResponse.ts'

export default async function getFileByPath(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }

    try {
        const result = await run(
            'SELECT id, name, description, data, storage_key, type, path, uploaded_at FROM files WHERE path = $1',
            [id]
        )

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'File not found' })
        }

        const file = result.rows[0]
        res.headers(fileResponseHeaders(file.name, file.type))
        return res.send(fileBody(file))
    } catch (error) {
        req.log.error({ error }, 'File read failed')
        res.status(500).send({ error: 'Internal server error' })
    }
}
