import type { FastifyReply, FastifyRequest } from 'fastify'
import tokenWrapper from './tokenWrapper.ts'

function readCookies(header: string | undefined) {
    const cookies = new Map<string, string>()
    for (const part of header?.split(';') || []) {
        const separator = part.indexOf('=')
        if (separator < 0) continue
        const key = part.slice(0, separator).trim()
        const value = part.slice(separator + 1).trim()
        try {
            cookies.set(key, decodeURIComponent(value))
        } catch {
            // Ignore malformed cookie values; authentication will fail closed.
        }
    }
    return cookies
}

export async function getSessionDetails(req: FastifyRequest) {
    const cookies = readCookies(req.headers.cookie)
    const id = cookies.get('id') || ''
    const token = cookies.get('access_token') || ''
    if (!id || !token) return null
    const auth = await tokenWrapper(id, token)
    if (!auth.status || !auth.id || !auth.expires_at) return null
    const expiresAt = Date.parse(auth.expires_at)
    if (!Number.isFinite(expiresAt)) return null
    return { id: auth.id, token: auth.token || token, expiresAt: new Date(expiresAt).toISOString() }
}

export function setSessionCookies(
    req: FastifyRequest,
    res: FastifyReply,
    session: NonNullable<Awaited<ReturnType<typeof getSessionDetails>>>,
) {
    const hostname = String(req.headers.host || '').split(':')[0].toLowerCase()
    const sharedDomain = hostname === 'hanasand.com' || hostname.endsWith('.hanasand.com')
        ? '; Domain=.hanasand.com'
        : ''
    const secure = sharedDomain || req.protocol === 'https' ? '; Secure' : ''
    const options = `; Expires=${new Date(session.expiresAt).toUTCString()}; Path=/; SameSite=Lax${sharedDomain}${secure}`
    res.header('Set-Cookie', [
        `access_token=${encodeURIComponent(session.token)}${options}`,
        `session_expires_at=${encodeURIComponent(session.expiresAt)}${options}`,
        `auth_checked_at=${encodeURIComponent(new Date().toISOString())}${options}`,
    ])
}

export async function getSessionUserId(req: FastifyRequest): Promise<string | null> {
    return (await getSessionDetails(req))?.id || null
}
