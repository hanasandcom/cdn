import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function listGroupsByEditor(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    if (!id) {
        return res.status(400).send({ error: 'id is required' })
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
            SELECT DISTINCT g.*
            FROM project_groups g
            JOIN project_group_members m ON g.id = m.group_id
            JOIN shares s ON s.id = m.share_id
            WHERE $1 = ANY(s.editors)
            ORDER BY g.created_at DESC
        `
        const result = await run(query, [id])
        return res.status(200).send(result.rows)
    } catch (error) {
        console.error('Failed to list groups by editor:', error)
        return res.status(500).send({ error: 'Failed to list groups' })
    }
}
