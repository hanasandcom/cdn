import type { FastifyReply, FastifyRequest } from 'fastify'
import { isIP } from 'node:net'
import config from '#constants'

type LoginPayload = { username?: string, password?: string }
type IdentityLogin = {
    id?: string
    name?: string
    avatar?: string | null
    token?: string
    expires_at?: string
    error?: string
}

export default async function login(req: FastifyRequest, res: FastifyReply) {
    const body = req.body as LoginPayload | null
    const username = typeof body?.username === 'string' ? body.username.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!username || username.length > 254 || !password || password.length > 1024) {
        return res.status(400).send({ error: 'Enter your username and password.' })
    }

    try {
        const response = await fetch(`${config.auth_api}/auth/login/${encodeURIComponent(username)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-request-id': req.id,
                ...(typeof req.headers['x-device-public-jwk'] === 'string' ? { 'x-device-public-jwk': req.headers['x-device-public-jwk'] } : {}),
                'user-agent': String(req.headers['user-agent'] || '').slice(0, 1000),
                ...(isIP(req.ip) ? { 'x-forwarded-for': req.ip } : {}),
            },
            body: JSON.stringify({ password }),
            cache: 'no-store',
            signal: AbortSignal.timeout(15_000),
        })
        const result = await response.json().catch(() => null) as IdentityLogin | null
        if (!response.ok) {
            const safeStatuses = new Set([400, 401, 403, 404, 423, 429])
            const status = safeStatuses.has(response.status) ? response.status : 502
            return res.status(status).send({
                error: result?.error || 'Sign-in failed. Please try again.',
            })
        }
        if (!result?.id || !result.name || !result.token) {
            req.log.error({ requestId: req.id }, 'Identity returned an incomplete login session')
            return res.status(502).send({ error: 'Sign-in service returned an incomplete session.' })
        }

        const hostname = String(req.headers.host || '').split(':')[0].toLowerCase()
        const sharedDomain = hostname === 'hanasand.com' || hostname.endsWith('.hanasand.com')
            ? '; Domain=.hanasand.com'
            : ''
        const secure = sharedDomain || req.protocol === 'https' ? '; Secure' : ''
        const expires = result.expires_at ? `; Expires=${new Date(result.expires_at).toUTCString()}` : ''
        const cookieOptions = `${expires}; Path=/; SameSite=Lax${sharedDomain}${secure}`
        const cookies = [
            `id=${encodeURIComponent(result.id)}${cookieOptions}`,
            `name=${encodeURIComponent(result.name)}${cookieOptions}`,
            `avatar=${encodeURIComponent(result.avatar || '')}${cookieOptions}`,
            `access_token=${encodeURIComponent(result.token)}${cookieOptions}`,
            ...(result.expires_at ? [`session_expires_at=${encodeURIComponent(result.expires_at)}${cookieOptions}`] : []),
            `auth_checked_at=${encodeURIComponent(new Date().toISOString())}${cookieOptions}`,
        ]
        res.header('Set-Cookie', cookies)
        res.header('Cache-Control', 'no-store')
        return res.send({ id: result.id, name: result.name })
    } catch (error) {
        req.log.warn({ error, requestId: req.id }, 'Identity sign-in request failed')
        return res.status(503).send({ error: 'Sign-in service is unavailable. Please try again.' })
    }
}
