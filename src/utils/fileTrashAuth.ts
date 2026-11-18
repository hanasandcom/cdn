import type { FastifyReply, FastifyRequest } from 'fastify'
import tokenWrapper from './auth/tokenWrapper.ts'
import { getSessionUserId } from './auth/session.ts'

export async function fileRequestUser(req: FastifyRequest, res: FastifyReply, mutation = false) {
    const headerId = req.headers.id
    const user = Array.isArray(headerId) ? headerId[0] : headerId
    const token = req.headers.authorization?.split(' ')[1]
    if (user && token) {
        const auth = await tokenWrapper(user, token, req)
        if (auth.status && auth.id) return auth.id
    } else {
        if (mutation) {
            let sameOrigin = false
            try {
                sameOrigin = typeof req.headers.origin === 'string'
                    && new URL(req.headers.origin).origin === `${req.protocol}://${req.headers.host}`
            } catch { /* Reject malformed origins. */ }
            if (!sameOrigin) {
                res.status(403).send({ error: 'Request origin is not allowed.' })
                return null
            }
        }
        const id = await getSessionUserId(req)
        if (id) return id
    }
    res.status(401).send({ error: 'Sign in to continue.' })
    return null
}
