import config from '#constants'

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

            throw new Error(await response.text())
        }

        const data = await response.json() as User & { token?: string, expires_at?: string }
        return { status: true, id: data.id, token: data.token || token, expires_at: data.expires_at || null }
    } catch (error) {
        console.log(error)
        return { status: false, id: null, token: null, expires_at: null }
    }
}
