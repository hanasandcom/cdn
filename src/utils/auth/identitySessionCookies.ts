import type { FastifyReply, FastifyRequest } from 'fastify'

export type IdentitySession = {
    id: string
    name: string
    avatar?: string | null
    token: string
    expires_at: string
}

export function setIdentitySessionCookies(req: FastifyRequest, res: FastifyReply, session: IdentitySession) {
    const expiresAt = new Date(session.expires_at)
    if (!Number.isFinite(expiresAt.getTime())) return false

    const hostname = String(req.headers.host || '').split(':')[0].toLowerCase()
    const sharedDomain = hostname === 'hanasand.com' || hostname.endsWith('.hanasand.com')
        ? '; Domain=.hanasand.com'
        : ''
    const secure = sharedDomain || req.protocol === 'https' ? '; Secure' : ''
    const options = `; Expires=${expiresAt.toUTCString()}; Path=/; SameSite=Lax${sharedDomain}${secure}`
    res.header('Set-Cookie', [
        `id=${encodeURIComponent(session.id)}${options}`,
        `name=${encodeURIComponent(session.name)}${options}`,
        `avatar=${encodeURIComponent(session.avatar || '')}${options}`,
        `access_token=${encodeURIComponent(session.token)}${options}`,
        `session_expires_at=${encodeURIComponent(expiresAt.toISOString())}${options}`,
        `auth_checked_at=${encodeURIComponent(new Date().toISOString())}${options}`,
    ])
    return true
}
