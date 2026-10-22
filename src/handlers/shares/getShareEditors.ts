import run from '#db'
import permissionsWrapper from '#utils/auth/permissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getShareEditors(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    if (!id) {
        return res.status(400).send({ error: 'Missing user id' })
    }

    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const allowed = await permissionsWrapper({ userId, shareId: id })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const query = `
            SELECT 
                s.*,
                NOT EXISTS (
                    SELECT 1 FROM shares c WHERE c.parent = s.id
                ) AS has_children
            FROM shares s
            WHERE $1 = ANY(s.editors)
            AND NOT EXISTS (
                SELECT 1 FROM shares c WHERE c.parent = s.id
            )
            ORDER BY s.timestamp DESC
        `

        const result = await run(query, [id])
        return res.status(200).send(result.rows)
    } catch (error) {
        console.log('Failed to fetch shares:', error)
        return res.status(500).send({ error: 'Failed to fetch shares' })
    }
}
