import type { FastifyReply, FastifyRequest } from 'fastify'
import config from '#constants'

const maxLoginFormBytes = 64 * 1024
const timeoutMs = 5_000
export type IdentityClientScript = 'login-form.js' | 'device-proof-client.js'

type Fetcher = typeof fetch

export function createIdentityClientScriptProxy(
    script: IdentityClientScript,
    authApi = config.auth_api,
    fetcher: Fetcher = fetch,
) {
    return async (_req: FastifyRequest, res: FastifyReply) => {
        try {
            const response = await fetcher(`${authApi}/auth/${script}`, {
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!response.ok) {
                return res.header('Cache-Control', 'no-store').status(503).send({ error: 'Sign-in form is unavailable.' })
            }

            const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
            const declaredLengthHeader = response.headers.get('content-length') || ''
            const declaredLength = Number(declaredLengthHeader)
            if (!['application/javascript', 'text/javascript'].includes(contentType)
                || (declaredLengthHeader && (!Number.isSafeInteger(declaredLength) || declaredLength > maxLoginFormBytes))) {
                return res.header('Cache-Control', 'no-store').status(502).send({ error: 'Sign-in form could not be loaded.' })
            }

            const body = await readBoundedBody(response)
            if (!body?.byteLength) {
                return res.header('Cache-Control', 'no-store').status(502).send({ error: 'Sign-in form could not be loaded.' })
            }

            return res
                .header('Cache-Control', 'no-store')
                .header('X-Content-Type-Options', 'nosniff')
                .type('application/javascript; charset=utf-8')
                .send(body)
        } catch {
            return res.header('Cache-Control', 'no-store').status(503).send({ error: 'Sign-in form is unavailable.' })
        }
    }
}

async function readBoundedBody(response: Response): Promise<Buffer | undefined> {
    if (!response.body) return undefined
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxLoginFormBytes) {
                await reader.cancel()
                return undefined
            }
            chunks.push(value)
        }
        return Buffer.concat(chunks, size)
    } catch {
        await reader.cancel().catch(() => undefined)
        return undefined
    }
}

export const loginForm = createIdentityClientScriptProxy('login-form.js')
export const deviceProofClient = createIdentityClientScriptProxy('device-proof-client.js')
