import type { FastifyReply, FastifyRequest } from 'fastify'
import { getSessionDetails, setSessionCookies } from '#utils/auth/session.ts'

export default async function getSession(req: FastifyRequest, res: FastifyReply) {
    res.header('Cache-Control', 'no-store')
    const session = await getSessionDetails(req)
    if (!session) return res.status(401).send({ error: 'Sign in to continue.' })
    setSessionCookies(req, res, session)
    return res.send({ id: session.id })
}
