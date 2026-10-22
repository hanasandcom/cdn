import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { getSessionUserId } from '#utils/auth/session.ts'

type FavoriteParams = { id: string }
type FavoriteBody = { favorite?: unknown }

function sameOrigin(req: FastifyRequest) {
    if (typeof req.headers.origin !== 'string' || typeof req.headers.host !== 'string') return false
    try {
        return new URL(req.headers.origin).origin === `${req.protocol}://${req.headers.host}`
    } catch {
        return false
    }
}

export default async function updateFavorite(
    req: FastifyRequest<{ Params: FavoriteParams, Body: FavoriteBody }>,
    res: FastifyReply,
) {
    if (!sameOrigin(req)) return res.status(403).send({ error: 'Request origin is not allowed.' })
    const userId = await getSessionUserId(req)
    if (!userId) return res.status(401).send({ error: 'Sign in to continue.' })
    const favorite = req.body?.favorite
    if (typeof favorite !== 'boolean') return res.status(400).send({ error: 'favorite must be a boolean.' })

    const result = await run(
        'UPDATE files SET is_favorite=$3 WHERE id=$1 AND owner=$2 RETURNING id,is_favorite',
        [req.params.id, userId, favorite],
    )
    if (!result.rowCount) return res.status(404).send({ error: 'Photo not found.' })
    return res.send({ id: result.rows[0].id, favorite: result.rows[0].is_favorite })
}
