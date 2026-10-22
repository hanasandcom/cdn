import run from '#db'
import permissionsWrapper from '#utils/auth/permissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function deleteShare(req: FastifyRequest, res: FastifyReply) {
    try {
        const { id } = req.params as { id: string }
        const user = req.headers['id'] as string || ''
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

        const result = await run(`
            WITH RECURSIVE subtree AS (
                SELECT id
                FROM shares
                WHERE id = $1
                UNION ALL
                SELECT child.id
                FROM shares child
                INNER JOIN subtree parent ON child.parent = parent.id
            )
            DELETE FROM shares
            WHERE id IN (SELECT id FROM subtree)
            RETURNING id
        `, [id])

        if (!result || result.rowCount === 0) {
            return res.status(404).send({ error: `Share ${id} not found` })
        }

        return res.status(200).send({ deleted: result.rowCount })
    } catch (error) {
        console.log(`Error deleting share: ${error}`)
        return res.status(500).send({ error: 'Failed to delete share' })
    }
}
