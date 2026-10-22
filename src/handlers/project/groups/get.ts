import run from '#db'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function listProjectsInGroup(req: FastifyRequest, res: FastifyReply) {
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

    const allowed = await projectPermissionsWrapper({ userId, projectId: id })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const query = `
            SELECT s.*, m.role
            FROM shares s
            JOIN project_group_members m ON s.id = m.share_id
            WHERE m.group_id = $1
        `
        const result = await run(query, [id])
        return res.status(200).send(result.rows)
    } catch (error) {
        console.error('Failed to list projects in group:', error)
        return res.status(500).send({ error: 'Failed to list projects in group' })
    }
}
