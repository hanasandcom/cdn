import { isIP } from 'node:net'
import { randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import config from '#constants'
import { setIdentitySessionCookies, type IdentitySession } from '#utils/auth/identitySessionCookies.ts'

const maxJsonBytes = 128 * 1024
const timeoutMs = 10_000
const validProviders = new Set(['apple', 'google'])
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

type IdentityError = { error?: unknown, code?: unknown }
type IdentityJson = Record<string, unknown> & IdentityError

export async function getPasskeyOptions(req: FastifyRequest, res: FastifyReply) {
    const query = req.query as { username?: unknown } | undefined
    const username = typeof query?.username === 'string' ? query.username.trim() : ''
    if (username.length > 254) return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Invalid account name.' })
    const params = username ? `?${new URLSearchParams({ username })}` : ''
    return proxyIdentityJson(req, res, `/auth/passkeys/authenticate/options${params}`, { method: 'GET' })
}

export async function postPasskeyVerify(req: FastifyRequest, res: FastifyReply) {
    const body = jsonRecord(req.body)
    if (!body || !boundedJson(body) || typeof body.challengeId !== 'string'
        || !uuidPattern.test(body.challengeId) || !isRecord(body.credential)) {
        return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Passkey sign-in request is invalid.' })
    }
    return proxyIdentityJson(req, res, '/auth/passkeys/authenticate/verify', {
        method: 'POST',
        body: { challengeId: body.challengeId, credential: body.credential },
        acceptSession: true,
    })
}

export async function getSocialProviders(req: FastifyRequest, res: FastifyReply) {
    return proxyIdentityJson(req, res, '/auth/social/providers', { method: 'GET' })
}

export async function postSsoStart(req: FastifyRequest, res: FastifyReply) {
    const body = authStartBody(req.body)
    if (!body) return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Sign-in request is invalid.' })
    return proxyIdentityJson(req, res, '/auth/sso/start', { method: 'POST', body })
}

export async function getSsoStart(req: FastifyRequest, res: FastifyReply) {
    if (String(req.headers.host || '').toLowerCase() !== 'cdn.hanasand.com' || req.protocol !== 'https') {
        return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Google sign-in must start from the secure CDN site.' })
    }
    res.header('Referrer-Policy', 'no-referrer')
    const query = req.query as { redirectPath?: unknown } | undefined
    const body = authStartBody({ binding: randomBytes(32).toString('base64url'), redirectPath: query?.redirectPath })
    if (!body) return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Sign-in request is invalid.' })
    return proxyIdentityJson(req, res, '/auth/sso/start', {
        method: 'POST',
        body,
        redirectToUrl: true,
        allowMissingOrigin: true,
    })
}

export async function postSocialStart(req: FastifyRequest, res: FastifyReply) {
    const { provider } = req.params as { provider?: string }
    if (!provider || !validProviders.has(provider)) {
        return res.header('Cache-Control', 'no-store').status(404).send({ error: 'Sign-in provider was not found.' })
    }
    const body = authStartBody(req.body)
    if (!body) return res.header('Cache-Control', 'no-store').status(400).send({ error: 'Sign-in request is invalid.' })
    return proxyIdentityJson(req, res, `/auth/social/${provider}/start`, { method: 'POST', body })
}

function authStartBody(value: unknown) {
    if (!isRecord(value)) return null
    const binding = value.binding === undefined ? randomBytes(32).toString('base64url') : value.binding
    if (typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return null
    const redirectUrl = localRedirectUrl(value.redirectPath)
    return { binding, redirectPath: redirectUrl }
}

function localRedirectUrl(value: unknown) {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\\') || hasControlCharacters(value)) {
        return 'https://cdn.hanasand.com/gallery'
    }
    try {
        const url = new URL(value, 'https://cdn.hanasand.com')
        return url.origin === 'https://cdn.hanasand.com' && !url.username && !url.password
            ? url.href
            : 'https://cdn.hanasand.com/gallery'
    } catch {
        return 'https://cdn.hanasand.com/gallery'
    }
}

function hasControlCharacters(value: string) {
    return [...value].some(char => {
        const code = char.charCodeAt(0)
        return code < 32 || code === 127
    })
}

async function proxyIdentityJson(
    req: FastifyRequest,
    res: FastifyReply,
    path: string,
    options: {
        method: 'GET' | 'POST',
        body?: Record<string, unknown>,
        acceptSession?: boolean,
        redirectToUrl?: boolean,
        allowMissingOrigin?: boolean,
    },
) {
    const origin = req.headers.origin
    const host = String(req.headers.host || '').toLowerCase()
    if (options.method === 'POST' && !origin && !options.allowMissingOrigin) {
        return res.header('Cache-Control', 'no-store').status(403).send({ error: 'Request origin was rejected.' })
    }
    if (origin) {
        let parsed: URL
        try {
            parsed = new URL(origin)
        } catch {
            return res.header('Cache-Control', 'no-store').status(403).send({ error: 'Request origin was rejected.' })
        }
        const expectedProtocol = host === 'hanasand.com' || host.endsWith('.hanasand.com')
            ? 'https:'
            : `${req.protocol}:`
        if (parsed.host.toLowerCase() !== host || parsed.protocol !== expectedProtocol) {
            return res.header('Cache-Control', 'no-store').status(403).send({ error: 'Request origin was rejected.' })
        }
    }

    const devicePublicJwk = headerString(req.headers['x-device-public-jwk'])
    const dpop = headerString(req.headers.dpop)
    try {
        const response = await fetch(`${config.auth_api}${path}`, {
            method: options.method,
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                accept: 'application/json',
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                'x-request-id': req.id,
                'user-agent': String(req.headers['user-agent'] || '').slice(0, 1000),
                ...(isIP(req.ip) ? { 'x-forwarded-for': req.ip } : {}),
                ...(devicePublicJwk ? { 'x-device-public-jwk': devicePublicJwk } : {}),
                ...(dpop ? { DPoP: dpop } : {}),
            },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        })
        const result = await readIdentityJson(response)
        if (!result) {
            return res.header('Cache-Control', 'no-store').status(502).send({ error: 'Sign-in service returned an invalid response.' })
        }
        if (!response.ok) {
            const safeStatuses = new Set([400, 401, 403, 404, 409, 423, 429])
            const status = safeStatuses.has(response.status) ? response.status : response.status === 503 ? 503 : 502
            const error = typeof result.error === 'string' && result.error.length <= 500
                ? result.error
                : 'Sign-in could not be completed.'
            const code = typeof result.code === 'string' && /^[a-z0-9_]{1,80}$/i.test(result.code) ? result.code : undefined
            return res.header('Cache-Control', 'no-store').status(status).send({ error, ...(code ? { code } : {}) })
        }

        if (options.acceptSession) {
            const session = identitySession(result)
            if (!session || !setIdentitySessionCookies(req, res, session)) {
                req.log.error({ requestId: req.id }, 'Identity returned an incomplete passkey session')
                return res.header('Cache-Control', 'no-store').status(502).send({
                    error: 'Sign-in service returned an incomplete session.',
                })
            }
            return res.header('Cache-Control', 'no-store').send({ id: session.id, name: session.name })
        }
        if (typeof result.url === 'string') {
            let url: URL
            try {
                url = new URL(result.url)
            } catch {
                return res.header('Cache-Control', 'no-store').status(502).send({
                    error: 'Sign-in service returned an invalid provider URL.',
                })
            }
            if (url.protocol !== 'https:') {
                return res.header('Cache-Control', 'no-store').status(502).send({
                    error: 'Sign-in service returned an invalid provider URL.',
                })
            }
            if (path === '/auth/sso/start' || path.startsWith('/auth/social/')) {
                setAuthBindingCookie(req, res, options.body?.binding)
            }
            if (options.redirectToUrl) {
                return res.header('Cache-Control', 'no-store').code(303).header('Location', url.toString()).send()
            }
        }
        return res.header('Cache-Control', 'no-store').send(result)
    } catch (error) {
        req.log.warn({ error, requestId: req.id }, 'Identity sign-in request failed')
        return res.header('Cache-Control', 'no-store').status(503).send({
            error: 'Sign-in service is unavailable. Please try again.',
        })
    }
}

function setAuthBindingCookie(req: FastifyRequest, res: FastifyReply, binding: unknown) {
    if (typeof binding !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return false
    const hostname = String(req.headers.host || '').split(':')[0].toLowerCase()
    if (hostname !== 'cdn.hanasand.com') return false
    res.header('Set-Cookie', `hanasand_auth_binding=${binding}; Max-Age=600; Path=/; SameSite=None; HttpOnly; Secure; Domain=.hanasand.com`)
    return true
}

async function readIdentityJson(response: Response): Promise<IdentityJson | null> {
    const type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    if (!['application/json', 'application/problem+json'].includes(type)) return null
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxJsonBytes)) return null
    if (!response.body) return null
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxJsonBytes) {
                await reader.cancel()
                return null
            }
            chunks.push(value)
        }
        const body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown
        return isRecord(body) ? body as IdentityJson : null
    } catch {
        await reader.cancel().catch(() => undefined)
        return null
    }
}

function identitySession(value: IdentityJson): IdentitySession | null {
    if (typeof value.id !== 'string' || !value.id || value.id.length > 254
        || typeof value.name !== 'string' || !value.name || value.name.length > 254
        || typeof value.token !== 'string' || !value.token || value.token.length > 8192
        || typeof value.expires_at !== 'string') return null
    return {
        id: value.id,
        name: value.name,
        avatar: typeof value.avatar === 'string' && value.avatar.length <= 4096 ? value.avatar : '',
        token: value.token,
        expires_at: value.expires_at,
    }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null
}

function boundedJson(value: unknown) {
    try { return Buffer.byteLength(JSON.stringify(value)) <= maxJsonBytes } catch { return false }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function headerString(value: string | string[] | undefined) {
    return (Array.isArray(value) ? value[0] : value)?.slice(0, 8192)
}
