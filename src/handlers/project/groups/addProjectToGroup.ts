import run from '#db'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function addProjectsToGroup(req: FastifyRequest, res: FastifyReply) {
    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const { id } = req.params as { id: string }
    const { shareIds, roles } = req.body as { shareIds: string[]; roles?: string[] }

    if (!id || !shareIds || !Array.isArray(shareIds) || shareIds.length === 0) {
        return res.status(400).send({ error: 'groupId and shareIds are required' })
    }

    const allowed = await projectPermissionsWrapper({ userId, projectId: id })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const inserts = shareIds.map((shareId, i) => {
            const role = roles?.[i] || null
            return run(
                `INSERT INTO project_group_members (group_id, share_id, role) VALUES ($1, $2, $3)
                 ON CONFLICT (group_id, share_id) DO NOTHING`,
                [id, shareId, role]
            )
        })
        await Promise.all(inserts)
        return res.status(200).send({ success: true })
    } catch (error) {
        console.error('Failed to add projects to group:', error)
        return res.status(500).send({ error: 'Failed to add projects to group' })
    }
}
