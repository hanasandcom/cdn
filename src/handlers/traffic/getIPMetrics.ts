import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export default async function getIPMetrics(this: FastifyInstance, req: FastifyRequest, res: FastifyReply) {
    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const allowed = await hasRole({ id: userId, role: 'system_admin', token })
    if (!allowed) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const response = this.cachedIPMetrics
    return res.type('application/json').status(response.status).send(response.data)
}
