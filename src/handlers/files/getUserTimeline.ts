import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import { getSessionUserId } from '#utils/auth/session.ts'

type TimelineParams = { id: string }
type TimelineQuery = { search?: string, favorites?: string, media?: string }

export default async function getUserTimeline(
    req: FastifyRequest<{ Params: TimelineParams, Querystring: TimelineQuery }>,
    res: FastifyReply,
) {
    res.header('Cache-Control', 'private, no-store')
    const { id } = req.params
    const user = req.headers.id
    const tokenHeader = req.headers.authorization || ''
    const token = Array.isArray(tokenHeader) ? tokenHeader[0]?.split(' ')[1] : tokenHeader.split(' ')[1]
    const headerUserId = Array.isArray(user) ? user[0] : user

    if (!id) return res.status(401).send({ error: 'Unauthorized' })
    const authenticatedId = headerUserId && token
        ? (await tokenWrapper(headerUserId, token, req)).id
        : await getSessionUserId(req)
    if (authenticatedId !== id) return res.status(401).send({ error: 'Unauthorized' })

    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : ''
    const favorites = req.query.favorites === 'true' ? 'true' : ''
    const media = req.query.media || ''
    if (media && media !== 'all' && media !== 'images' && media !== 'videos') {
        return res.status(400).send({ error: 'media must be all, images, or videos.' })
    }
    try {
        const result = await run(`SELECT TO_CHAR(
                CASE WHEN photo_taken_at IS NOT NULL
                    THEN (photo_taken_at AT TIME ZONE 'UTC')
                        + COALESCE(photo_taken_offset_minutes,0) * INTERVAL '1 minute'
                    ELSE uploaded_at AT TIME ZONE 'UTC'
                END,
                'YYYY-MM'
            ) AS month_key,
            COUNT(*)::int AS photo_count
            FROM files
            WHERE owner=$1
              AND type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
                  'video/mp4','video/webm','video/ogg')
              AND ($2='' OR strpos(lower(name),lower($2))>0
                  OR strpos(lower(concat_ws(' ',location_label,latitude::text,longitude::text)),lower($2))>0)
              AND ($3='' OR is_favorite)
              AND ($4='' OR ($4='all' AND type IN (
                    'image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
                    'video/mp4','video/webm','video/ogg'
                  )) OR ($4='images' AND type IN (
                    'image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif'
                  )) OR ($4='videos' AND type IN ('video/mp4','video/webm','video/ogg')))
            GROUP BY 1 ORDER BY 1 DESC`, [id, search, favorites, media])
        return res.send(result.rows)
    } catch (error) {
        req.log.error({ error, userId: id }, 'Failed to fetch user photo timeline')
        return res.status(500).send({ error: 'Internal server error' })
    }
}
