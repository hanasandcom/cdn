import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import loadSQL from '#utils/loadSQL.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getUserProjects(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    if (!id) {
        return res.status(400).send({ error: 'Missing user id.' })
    }

    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const query = await loadSQL('getProjects.sql')
        const result = await run(query, [id])
        return res.status(200).send(result.rows)
    } catch (error) {
        console.log('Failed to fetch user projects:', error)
        return res.status(500).send({ error: 'Failed to fetch user projects' })
    }
}
