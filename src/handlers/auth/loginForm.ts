import type { FastifyReply, FastifyRequest } from 'fastify'
import config from '#constants'

const timeoutMs = 5_000

type Fetcher = typeof fetch
type IdentityAsset = 'login-form.js' | 'device-proof-client.js' | 'device-proof' | 'device-proof.js' | 'device-proof/origins'
const identityAssets: Record<IdentityAsset, { contentType: string, maxBytes: number }> = {
    'login-form.js': { contentType: 'application/javascript', maxBytes: 64 * 1024 },
    'device-proof-client.js': { contentType: 'application/javascript', maxBytes: 64 * 1024 },
    'device-proof': { contentType: 'text/html', maxBytes: 16 * 1024 },
    'device-proof.js': { contentType: 'application/javascript', maxBytes: 64 * 1024 },
    'device-proof/origins': { contentType: 'application/json', maxBytes: 16 * 1024 },
}

export function createIdentityScriptProxy(
    script: IdentityAsset,
    authApi = config.auth_api,
    fetcher: Fetcher = fetch,
) {
    return async (_req: FastifyRequest, res: FastifyReply) => {
        try {
            const asset = identityAssets[script]
            const response = await fetcher(`${authApi}/auth/${script}`, {
                cache: 'no-store',
                redirect: 'error',
                signal: AbortSignal.timeout(timeoutMs),
            })
            if (!response.ok) {
                return res.header('Cache-Control', 'no-store').status(503).send({ error: 'Sign-in asset is unavailable.' })
            }

            const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
            const declaredLengthHeader = response.headers.get('content-length') || ''
            const declaredLength = Number(declaredLengthHeader)
            const validContentType = asset.contentType === 'application/javascript'
                ? ['application/javascript', 'text/javascript'].includes(contentType)
                : contentType === asset.contentType
            if (!validContentType
                || (declaredLengthHeader && (!Number.isSafeInteger(declaredLength) || declaredLength > asset.maxBytes))) {
                return res.header('Cache-Control', 'no-store').status(502).send({ error: 'Sign-in asset could not be loaded.' })
            }

            const body = await readBoundedBody(response, asset.maxBytes)
            if (!body?.byteLength) {
                return res.header('Cache-Control', 'no-store').status(502).send({ error: 'Sign-in asset could not be loaded.' })
            }

            return res
                .header('Cache-Control', 'no-store')
                .header('X-Content-Type-Options', 'nosniff')
                .type(`${asset.contentType}; charset=utf-8`)
                .send(body)
        } catch {
            return res.header('Cache-Control', 'no-store').status(503).send({ error: 'Sign-in asset is unavailable.' })
        }
    }
}

export const createLoginFormProxy = (authApi = config.auth_api, fetcher: Fetcher = fetch) =>
    createIdentityScriptProxy('login-form.js', authApi, fetcher)

export const createDeviceProofClientProxy = (authApi = config.auth_api, fetcher: Fetcher = fetch) =>
    createIdentityScriptProxy('device-proof-client.js', authApi, fetcher)

export const createDeviceProofBrokerProxy = (authApi = config.auth_api, fetcher: Fetcher = fetch) =>
    createIdentityScriptProxy('device-proof', authApi, fetcher)

export const createDeviceProofBrokerScriptProxy = (authApi = config.auth_api, fetcher: Fetcher = fetch) =>
    createIdentityScriptProxy('device-proof.js', authApi, fetcher)

export const createDeviceProofOriginsProxy = (authApi = config.auth_api, fetcher: Fetcher = fetch) =>
    createIdentityScriptProxy('device-proof/origins', authApi, fetcher)

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer | undefined> {
    if (!response.body) return undefined
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > maxBytes) {
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

export default createLoginFormProxy()
