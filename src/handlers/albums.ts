import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import { getSessionUserId } from '#utils/auth/session.ts'

type AlbumParams = { id: string, fileId?: string, userId?: string, token?: string }
type AlbumQuery = { limit?: string, offset?: string, search?: string, month?: string }
type AlbumBody = { name?: unknown, isPublic?: unknown, userId?: unknown, role?: unknown, fileIds?: unknown }

async function signedIn(req: FastifyRequest, res: FastifyReply) {
    const userId = await getSessionUserId(req)
    if (!userId) res.status(401).send({ error: 'Sign in to continue.' })
    return userId
}

function sameOrigin(req: FastifyRequest) {
    if (typeof req.headers.origin !== 'string' || typeof req.headers.host !== 'string') return false
    try {
        return new URL(req.headers.origin).origin === `${req.protocol}://${req.headers.host}`
    } catch {
        return false
    }
}

function rejectCrossOriginMutation(req: FastifyRequest, res: FastifyReply) {
    if (sameOrigin(req)) return false
    res.status(403).send({ error: 'Request origin is not allowed.' })
    return true
}

async function albumPermission(albumId: string, userId: string) {
    const result = await run(`SELECT a.owner,
        COALESCE(m.role, '') AS role
        FROM photo_albums a
        LEFT JOIN photo_album_members m ON m.album_id=a.id AND m.user_id=$2
        WHERE a.id=$1`, [albumId, userId])
    const row = result.rows[0] as { owner: string, role: string } | undefined
    return row ? { exists: true, owner: row.owner === userId, role: row.role } : { exists: false, owner: false, role: '' }
}

function validName(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const name = value.trim()
    return name.length > 0 && name.length <= 120 && !/[\0\r\n]/.test(name) ? name : null
}

function validMonth(value: string | undefined): string {
    if (!value) return ''
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : 'invalid'
}

async function albumTimeline(albumId: string, search: string) {
    return run(`SELECT TO_CHAR(
            CASE WHEN f.photo_taken_at IS NOT NULL
                THEN (f.photo_taken_at AT TIME ZONE 'UTC')
                    + COALESCE(f.photo_taken_offset_minutes,0) * INTERVAL '1 minute'
                ELSE f.uploaded_at AT TIME ZONE 'UTC'
            END,
            'YYYY-MM'
        ) AS month_key,
        COUNT(*)::int AS photo_count
        FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=$1
          AND (f.type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
              'video/mp4','video/webm','video/ogg'))
          AND ($2='' OR strpos(lower(f.name),lower($2))>0
              OR strpos(lower(concat_ws(' ',f.location_label,f.latitude::text,f.longitude::text)),lower($2))>0)
        GROUP BY 1 ORDER BY 1 DESC`, [albumId, search])
}

export async function listAlbums(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'no-store')
    const userId = await signedIn(req, res)
    if (!userId) return
    const result = await run(`SELECT a.id,a.name,a.owner,a.public_token IS NOT NULL AS is_public,a.created_at,a.updated_at,
        COUNT(i.file_id)::int AS photo_count,
        (SELECT f.id FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=a.id ORDER BY pi.added_at DESC LIMIT 1) AS cover_file_id,
        CASE WHEN a.owner=$1 THEN 'owner' ELSE m.role END AS member_role
        FROM photo_albums a
        LEFT JOIN photo_album_members m ON m.album_id=a.id AND m.user_id=$1
        LEFT JOIN photo_album_items i ON i.album_id=a.id
        WHERE a.owner=$1 OR m.user_id=$1
        GROUP BY a.id,a.name,a.owner,a.public_token,a.created_at,a.updated_at,m.role
        ORDER BY a.updated_at DESC,a.id`, [userId])
    return res.send(result.rows)
}

export async function createAlbum(req: FastifyRequest, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const name = validName((req.body as AlbumBody | undefined)?.name)
    if (!name) return res.status(400).send({ error: 'Album names must be 1–120 characters.' })
    const id = randomUUID()
    const result = await run(`INSERT INTO photo_albums (id,owner,name) VALUES ($1,$2,$3)
        RETURNING id,name,owner,created_at,updated_at`, [id, userId, name])
    return res.status(201).send({ ...result.rows[0], is_public: false, photo_count: 0 })
}

export async function getAlbum(req: FastifyRequest<{ Params: AlbumParams, Querystring: AlbumQuery }>, res: FastifyReply) {
    res.header('Cache-Control', 'private, no-store')
    const userId = await signedIn(req, res)
    if (!userId) return
    const { id } = req.params
    const access = await albumPermission(id, userId)
    if (!access.exists || (!access.owner && !access.role)) return res.status(404).send({ error: 'Album not found.' })
    const album = await run(`SELECT id,name,owner,public_token IS NOT NULL AS is_public,created_at,updated_at
        FROM photo_albums WHERE id=$1`, [id])
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 100)
    const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(req.query.offset || '0', 10) || 0))
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : ''
    const month = validMonth(req.query.month)
    if (month === 'invalid') return res.status(400).send({ error: 'Month must use YYYY-MM format.' })
    const [items, total] = await Promise.all([run(`SELECT f.id,f.name,f.type,f.owner,f.is_favorite,f.uploaded_at,f.photo_taken_at,
        f.photo_taken_offset_minutes,f.location_label,f.latitude,f.longitude,
        COALESCE(f.storage_size,octet_length(f.data)) AS size_bytes, pi.added_at, pi.added_by
        FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=$1 AND f.type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
            'video/mp4','video/webm','video/ogg')
          AND ($4='' OR strpos(lower(f.name),lower($4))>0
            OR strpos(lower(concat_ws(' ',f.location_label,f.latitude::text,f.longitude::text)),lower($4))>0)
            AND ($5='' OR TO_CHAR(CASE WHEN f.photo_taken_at IS NOT NULL
                THEN (f.photo_taken_at AT TIME ZONE 'UTC')
                    + COALESCE(f.photo_taken_offset_minutes,0) * INTERVAL '1 minute'
                ELSE f.uploaded_at AT TIME ZONE 'UTC' END,'YYYY-MM')=$5)
        ORDER BY COALESCE(f.photo_taken_at,f.uploaded_at) DESC,f.id LIMIT $2 OFFSET $3`,
    [id, limit, offset, search, month]),
    run(`SELECT COUNT(*)::int AS total FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=$1 AND f.type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
            'video/mp4','video/webm','video/ogg')
          AND ($2='' OR strpos(lower(f.name),lower($2))>0
            OR strpos(lower(concat_ws(' ',f.location_label,f.latitude::text,f.longitude::text)),lower($2))>0)
            AND ($3='' OR TO_CHAR(CASE WHEN f.photo_taken_at IS NOT NULL
                THEN (f.photo_taken_at AT TIME ZONE 'UTC')
                    + COALESCE(f.photo_taken_offset_minutes,0) * INTERVAL '1 minute'
                ELSE f.uploaded_at AT TIME ZONE 'UTC' END,'YYYY-MM')=$3)`, [id, search, month])])
    const timeline = await albumTimeline(id, search)
    const members = access.owner
        ? await run('SELECT user_id,role,added_at FROM photo_album_members WHERE album_id=$1 ORDER BY user_id', [id])
        : null
    return res.send({ ...album.rows[0], role: access.owner ? 'owner' : access.role,
        items: items.rows, total: total.rows[0].total, limit, offset,
        timeline: timeline.rows, month, members: members?.rows })
}

export async function updateAlbum(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const { id } = req.params
    const body = (req.body || {}) as AlbumBody
    const name = body.name === undefined ? undefined : validName(body.name)
    if (body.name !== undefined && !name) return res.status(400).send({ error: 'Album names must be 1–120 characters.' })
    if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') {
        return res.status(400).send({ error: 'isPublic must be a boolean.' })
    }
    const permission = await albumPermission(id, userId)
    if (!permission.exists) return res.status(404).send({ error: 'Album not found.' })
    if (!permission.owner) return res.status(403).send({ error: 'Only the album owner can change album settings.' })
    const publicToken = body.isPublic === true ? randomBytes(24).toString('base64url') : null
    const result = await run(`UPDATE photo_albums SET
        name=COALESCE($2,name),
        public_token=CASE WHEN $3::boolean IS NULL THEN public_token WHEN $3 THEN COALESCE(public_token,$4) ELSE NULL END,
        updated_at=NOW()
        WHERE id=$1 RETURNING id,name,owner,public_token IS NOT NULL AS is_public,public_token,updated_at`,
    [id, name ?? null, body.isPublic ?? null, publicToken])
    return res.send(result.rows[0])
}

export async function deleteAlbum(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const result = await run('DELETE FROM photo_albums WHERE id=$1 AND owner=$2 RETURNING id', [req.params.id, userId])
    if (!result.rowCount) return res.status(404).send({ error: 'Album not found.' })
    return res.send({ deleted: result.rows[0].id })
}

export async function addAlbumItems(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const fileIds = (req.body as AlbumBody | undefined)?.fileIds
    if (!Array.isArray(fileIds) || fileIds.length < 1 || fileIds.length > 500
        || fileIds.some(id => typeof id !== 'string' || id.length > 128)) {
        return res.status(400).send({ error: 'Choose between 1 and 500 files.' })
    }
    const permission = await albumPermission(req.params.id, userId)
    if (!permission.exists || (!permission.owner && permission.role !== 'contributor')) {
        return res.status(404).send({ error: 'Album not found.' })
    }
    const result = await run(`INSERT INTO photo_album_items (album_id,file_id,added_by)
        SELECT $1,f.id,$2 FROM files f WHERE f.owner=$2 AND f.id=ANY($3::text[])
        ON CONFLICT (album_id,file_id) DO NOTHING RETURNING file_id`, [req.params.id, userId, [...new Set(fileIds as string[])]])
    await run('UPDATE photo_albums SET updated_at=NOW() WHERE id=$1', [req.params.id])
    return res.send({ added: result.rowCount, requested: new Set(fileIds).size })
}

export async function removeAlbumItem(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const permission = await albumPermission(req.params.id, userId)
    if (!permission.exists || (!permission.owner && permission.role !== 'contributor')) {
        return res.status(404).send({ error: 'Album not found.' })
    }
    const result = await run(`DELETE FROM photo_album_items i USING photo_albums a
        WHERE i.album_id=a.id AND i.album_id=$1 AND i.file_id=$2
        AND (a.owner=$3 OR i.added_by=$3) RETURNING i.file_id`, [req.params.id, req.params.fileId || '', userId])
    if (!result.rowCount) return res.status(404).send({ error: 'Photo not found in this album.' })
    await run('UPDATE photo_albums SET updated_at=NOW() WHERE id=$1', [req.params.id])
    return res.send({ removed: result.rows[0].file_id })
}

export async function addAlbumMember(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const body = (req.body || {}) as AlbumBody
    if (typeof body.userId !== 'string' || !/^[a-zA-Z0-9._-]{3,80}$/.test(body.userId) || body.userId === userId) {
        return res.status(400).send({ error: 'Enter another Hanasand account ID.' })
    }
    const role = body.role === 'contributor' ? 'contributor' : 'viewer'
    const permission = await albumPermission(req.params.id, userId)
    if (!permission.exists) return res.status(404).send({ error: 'Album not found.' })
    if (!permission.owner) return res.status(403).send({ error: 'Only the album owner can invite people.' })
    const result = await run(`INSERT INTO photo_album_members (album_id,user_id,role)
        VALUES ($1,$2,$3) ON CONFLICT (album_id,user_id)
        DO UPDATE SET role=EXCLUDED.role RETURNING user_id,role,added_at`,
    [req.params.id, body.userId, role])
    return res.status(201).send(result.rows[0])
}

export async function removeAlbumMember(req: FastifyRequest<{ Params: AlbumParams }>, res: FastifyReply) {
    if (rejectCrossOriginMutation(req, res)) return
    const userId = await signedIn(req, res)
    if (!userId) return
    const targetId = req.params.userId || userId
    const permission = await albumPermission(req.params.id, userId)
    if (!permission.exists) return res.status(404).send({ error: 'Album not found.' })
    if (!permission.owner && targetId !== userId) return res.status(403).send({ error: 'Only the album owner can remove people.' })
    const result = await run(
        'DELETE FROM photo_album_members WHERE album_id=$1 AND user_id=$2 RETURNING user_id',
        [req.params.id, targetId],
    )
    if (!result.rowCount) return res.status(404).send({ error: 'Album member not found.' })
    return res.send({ removed: result.rows[0].user_id })
}

export async function getPublicAlbum(req: FastifyRequest<{ Params: AlbumParams, Querystring: AlbumQuery }>, res: FastifyReply) {
    res.header('Cache-Control', 'no-store')
    const token = req.params.token || ''
    const album = await run('SELECT id,name FROM photo_albums WHERE public_token=$1', [token])
    if (!album.rowCount) return res.status(404).send({ error: 'Album not found.' })
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit || '100', 10) || 100, 1), 100)
    const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(req.query.offset || '0', 10) || 0))
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : ''
    const month = validMonth(req.query.month)
    if (month === 'invalid') return res.status(400).send({ error: 'Month must use YYYY-MM format.' })
    const [items, total] = await Promise.all([run(`SELECT f.id,f.name,f.type,f.uploaded_at,f.photo_taken_at,
        f.photo_taken_offset_minutes,f.location_label,f.latitude,f.longitude,
        COALESCE(f.storage_size,octet_length(f.data)) AS size_bytes
        FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=$1 AND f.type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
            'video/mp4','video/webm','video/ogg')
          AND ($4='' OR strpos(lower(f.name),lower($4))>0
            OR strpos(lower(concat_ws(' ',f.location_label,f.latitude::text,f.longitude::text)),lower($4))>0)
            AND ($5='' OR TO_CHAR(CASE WHEN f.photo_taken_at IS NOT NULL
                THEN (f.photo_taken_at AT TIME ZONE 'UTC')
                    + COALESCE(f.photo_taken_offset_minutes,0) * INTERVAL '1 minute'
                ELSE f.uploaded_at AT TIME ZONE 'UTC' END,'YYYY-MM')=$5)
        ORDER BY COALESCE(f.photo_taken_at,f.uploaded_at) DESC,f.id
        LIMIT $2 OFFSET $3`, [album.rows[0].id, limit, offset, search, month]),
    run(`SELECT COUNT(*)::int AS total
        FROM photo_album_items pi JOIN files f ON f.id=pi.file_id
        WHERE pi.album_id=$1 AND f.type IN ('image/jpeg','image/png','image/gif','image/webp','image/avif','image/heic','image/heif',
            'video/mp4','video/webm','video/ogg') AND (
            $2='' OR strpos(lower(f.name),lower($2))>0
            OR strpos(lower(concat_ws(' ',f.location_label,f.latitude::text,f.longitude::text)),lower($2))>0
        ) AND ($3='' OR TO_CHAR(CASE WHEN f.photo_taken_at IS NOT NULL
            THEN (f.photo_taken_at AT TIME ZONE 'UTC')
                + COALESCE(f.photo_taken_offset_minutes,0) * INTERVAL '1 minute'
            ELSE f.uploaded_at AT TIME ZONE 'UTC' END,'YYYY-MM')=$3)`, [album.rows[0].id, search, month])])
    const timeline = await albumTimeline(album.rows[0].id, search)
    return res.send({
        id: album.rows[0].id, name: album.rows[0].name, items: items.rows,
        total: total.rows[0].total, limit, offset, timeline: timeline.rows, month,
    })
}
