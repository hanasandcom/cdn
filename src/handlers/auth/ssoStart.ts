import type { FastifyReply, FastifyRequest } from 'fastify'
import { safeCdnReturnPath } from '#utils/auth/safeCdnReturnPath.ts'

const CDN_HOST = 'cdn.hanasand.com'
const CDN_ORIGIN = `https://${CDN_HOST}`
const HANASAND_SSO_START = 'https://hanasand.com/api/auth/sso/start'

export default async function startSso(req: FastifyRequest, res: FastifyReply) {
    if (String(req.headers.host || '').toLowerCase() !== CDN_HOST || req.protocol !== 'https') {
        res.header('Cache-Control', 'no-store')
        return res.status(400).send({ error: 'Google sign-in must start from the secure CDN site.' })
    }

    const query = req.query as { redirectPath?: unknown } | undefined
    const redirectPath = safeCdnReturnPath(query?.redirectPath)
    const returnTo = new URL(redirectPath, CDN_ORIGIN)
    const target = new URL(HANASAND_SSO_START)
    target.searchParams.set('returnTo', returnTo.toString())

    res.header('Cache-Control', 'no-store')
    res.header('Referrer-Policy', 'no-referrer')
    return res.redirect(target.toString(), 303)
}
