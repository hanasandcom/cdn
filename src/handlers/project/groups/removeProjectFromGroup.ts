import type { FastifyReply, FastifyRequest } from 'fastify'
import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'

export default async function removeProjectsFromGroup(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    const { shareIds } = req.body as { shareIds: string[] }
    if (!id || !shareIds || !Array.isArray(shareIds) || shareIds.length === 0) {
        return res.status(400).send({ error: 'id and shareIds are required' })
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
            DELETE FROM project_group_members
            WHERE group_id = $1 AND share_id = ANY($2::text[])
        `
        await run(query, [id, shareIds])
        return res.status(200).send({ success: true })
    } catch (error) {
        console.error('Failed to remove projects from group:', error)
        return res.status(500).send({ error: 'Failed to remove projects from group' })
    }
}
