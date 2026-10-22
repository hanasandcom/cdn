import type { FastifyReply, FastifyRequest } from 'fastify'

const CDN_HOST = 'cdn.hanasand.com'
const CDN_RETURN_TO = 'https://cdn.hanasand.com/'
const HANASAND_SSO_START = 'https://hanasand.com/api/auth/sso/start'

export default async function startSso(req: FastifyRequest, res: FastifyReply) {
    if (String(req.headers.host || '').toLowerCase() !== CDN_HOST || req.protocol !== 'https') {
        res.header('Cache-Control', 'no-store')
        return res.status(400).send({ error: 'Google sign-in must start from the secure CDN site.' })
    }

    const target = new URL(HANASAND_SSO_START)
    target.searchParams.set('returnTo', CDN_RETURN_TO)
    res.header('Cache-Control', 'no-store')
    res.header('Referrer-Policy', 'no-referrer')
    return res.redirect(target.toString(), 303)
}
