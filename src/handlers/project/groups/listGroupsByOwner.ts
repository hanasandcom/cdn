import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function listGroupsByOwner(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    if (!id) {
        return res.status(400).send({ error: 'userId is required' })
    }

    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    if (userId !== id) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const query = `
            SELECT *
            FROM project_groups
            WHERE owner = $1
            ORDER BY created_at DESC
        `
        const result = await run(query, [id])
        return res.status(200).send(result.rows)
    } catch (error) {
        console.error('Failed to list groups by owner:', error)
        return res.status(500).send({ error: 'Failed to list groups' })
    }
}
