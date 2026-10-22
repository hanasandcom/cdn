import type { FastifyReply, FastifyRequest } from 'fastify'
import config from '#constants'
import { getSessionDetails } from '#utils/auth/session.ts'

export default async function logout(req: FastifyRequest, reply: FastifyReply) {
    const session = await getSessionDetails(req)
    if (session) {
        try {
            await fetch(`${config.auth_api}/auth/logout/${encodeURIComponent(session.id)}`, {
                headers: { Authorization: `Bearer ${session.token}` },
                cache: 'no-store',
                signal: AbortSignal.timeout(10_000),
            })
        } catch (error) {
            req.log.warn({ error, requestId: req.id }, 'Identity logout request failed')
        }
    }

    const host = String(req.headers.host || '').split(':')[0].toLowerCase()
    const sharedDomain = host === 'hanasand.com' || host.endsWith('.hanasand.com') ? '; Domain=.hanasand.com' : ''
    const secure = sharedDomain || req.protocol === 'https' ? '; Secure' : ''
    const clearedCookies = ['id', 'name', 'avatar', 'access_token', 'session_expires_at', 'auth_checked_at', 'roles']
        .map(name => `${name}=; Max-Age=0; Path=/; SameSite=Lax${sharedDomain}${secure}`)
    reply.header('Set-Cookie', clearedCookies)
    return reply.header('Cache-Control', 'no-store').redirect('/login')
}
