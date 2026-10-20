import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import { getSessionUserId } from '#utils/auth/session.ts'

type UserFilesParams = {
    id: string
}

type UserFilesQuery = {
    limit?: string
    offset?: string
}

export default async function getUserFiles(
    req: FastifyRequest<{ Params: UserFilesParams, Querystring: UserFilesQuery }>,
    res: FastifyReply,
) {
    res.header('Cache-Control', 'no-store')

    const { id } = req.params
    const user = req.headers.id
    const tokenHeader = req.headers.authorization || ''
    const token = Array.isArray(tokenHeader) ? tokenHeader[0]?.split(' ')[1] : tokenHeader.split(' ')[1]
    const headerUserId = Array.isArray(user) ? user[0] : user

    if (!id) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const authenticatedId = headerUserId && token
        ? (await tokenWrapper(headerUserId, token)).id
        : await getSessionUserId(req)
    if (authenticatedId !== id) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '60', 10) || 60, 1), 100)

    const offset = Math.max(0, Math.min(1000000, Number.parseInt(req.query.offset || '0', 10) || 0))

    try {
        const result = await run(
            `SELECT id, name, description, type, path, owner, uploaded_at, COALESCE(storage_size,octet_length(data)) AS size_bytes
             FROM files
             WHERE owner = $1
             ORDER BY uploaded_at DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [id, limit, offset]
        )

        return res.send(result.rows)
    } catch (error) {
        req.log.error({ error, userId: id }, 'Failed to fetch user files')
        return res.status(500).send({ error: 'Internal server error' })
    }
}
