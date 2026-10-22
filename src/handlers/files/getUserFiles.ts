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
    sort?: string
    search?: string
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
        ? (await tokenWrapper(headerUserId, token, req)).id
        : await getSessionUserId(req)
    if (authenticatedId !== id) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '60', 10) || 60, 1), 100)

    const offset = Math.max(0, Math.min(1000000, Number.parseInt(req.query.offset || '0', 10) || 0))
    const order = req.query.sort === 'uploaded'
        ? 'uploaded_at DESC, id DESC'
        : 'COALESCE(photo_taken_at,uploaded_at) DESC, id DESC'
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : ''

    try {
        const result = await run(
            `SELECT id, name, description, type, path, owner, uploaded_at,
                    photo_taken_at, photo_taken_offset_minutes, location_label, latitude, longitude,
                    COALESCE(storage_size,octet_length(data)) AS size_bytes
             FROM files
             WHERE owner = $1
               AND ($4 = '' OR strpos(lower(name),lower($4)) > 0
                    OR strpos(lower(concat_ws(' ',location_label,latitude::text,longitude::text)),lower($4)) > 0)
             ORDER BY ${order}
             LIMIT $2 OFFSET $3`,
            [id, limit, offset, search]
        )

        return res.send(result.rows)
    } catch (error) {
        req.log.error({ error, userId: id }, 'Failed to fetch user files')
        return res.status(500).send({ error: 'Internal server error' })
    }
}
