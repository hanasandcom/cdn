import type { FastifyReply, FastifyRequest } from 'fastify'
import { getSessionUserId } from '#utils/auth/session.ts'

export default async function getSession(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'no-store')
    const id = await getSessionUserId(req)
    if (!id) return res.status(401).send({ error: 'Sign in to continue.' })
    return res.send({ id })
}
