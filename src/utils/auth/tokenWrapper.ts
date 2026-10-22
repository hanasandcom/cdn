import config from '#constants'
import type { FastifyRequest } from 'fastify'

export class AuthServiceUnavailableError extends Error {
    readonly statusCode = 503
    readonly code = 'AUTH_SERVICE_UNAVAILABLE'

    constructor(cause?: unknown) {
        super('Identity service is unavailable.', { cause })
        this.name = 'AuthServiceUnavailableError'
    }
}

export default async function tokenWrapper(id: string, token: string, req?: FastifyRequest): Promise<{
    status: boolean
    id: string | null
    token: string | null
    expires_at: string | null
}> {
    if (!id || !token) {
        return { status: false, id: null, token: null, expires_at: null }
    }

    try {
        const requestPath = req ? (req.url || '/').split('?')[0] : '/api/auth/session'
        const forwardedHost = req?.headers['x-forwarded-host'] || req?.headers.host || ''
        const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost
        const forwardedProto = req?.headers['x-forwarded-proto']
        const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || req?.protocol || 'https'
        const proof = req?.headers.dpop
        const dpop = Array.isArray(proof) ? proof[0] : proof
        const method = req?.method || 'GET'
        const response = await fetch(`${config.auth_api}/auth/token/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(5000),
            headers: {
                'Authorization': `Bearer ${token}`,
                ...(dpop ? { DPoP: dpop } : {}),
                ...(req ? {
                    'x-device-proof-url': `${protocol}://${host}${requestPath}`,
                    'x-device-proof-method': method,
                } : {}),
            }
        })

        if (!response.ok) {
            if (response.status === 401) {
                return { status: false, id: null, token: null, expires_at: null }
            }

            throw new AuthServiceUnavailableError()
        }

        const data = await response.json() as User & { token?: string, expires_at?: string }
        return { status: true, id: data.id, token: data.token || token, expires_at: data.expires_at || null }
    } catch (error) {
        if (error instanceof AuthServiceUnavailableError) throw error
        throw new AuthServiceUnavailableError(error)
    }
}
