import config from '#constants'

export class AuthServiceUnavailableError extends Error {
    readonly statusCode = 503
    readonly code = 'AUTH_SERVICE_UNAVAILABLE'

    constructor(cause?: unknown) {
        super('Identity service is unavailable.', { cause })
        this.name = 'AuthServiceUnavailableError'
    }
}

export default async function tokenWrapper(id: string, token: string): Promise<{
    status: boolean
    id: string | null
    token: string | null
    expires_at: string | null
}> {
    if (!id || !token) {
        return { status: false, id: null, token: null, expires_at: null }
    }

    try {
        const response = await fetch(`${config.auth_api}/auth/token/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(5000),
            headers: {
                'Authorization': `Bearer ${token}`
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
