import run from '#db'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function deleteProjectGroup(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
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

    if (!id) {
        return res.status(400).send({ error: 'Missing id' })
    }

    try {
        const query = `
            DELETE FROM project_groups
            WHERE id = $1
            RETURNING *
        `

        const result = await run(query, [id])

        if (!result || result.rowCount === 0) {
            return res.status(404).send({ error: `Project group ${id} not found` })
        }

        return res.status(200).send({
            deleted: true,
            group: result.rows[0],
        })
    } catch (error) {
        console.error('Error deleting project group:', error)
        return res.status(500).send({ error: 'Failed to delete project group' })
    }
}
