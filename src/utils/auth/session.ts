import type { FastifyRequest } from 'fastify'
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

export async function getSessionUserId(req: FastifyRequest): Promise<string | null> {
    const cookies = readCookies(req.headers.cookie)
    const id = cookies.get('id') || ''
    const token = cookies.get('access_token') || ''
    if (!id || !token) return null
    const auth = await tokenWrapper(id, token)
    return auth.status ? auth.id : null
}
