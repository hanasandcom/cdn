import run from '#db'
import permissionsWrapper from '#utils/auth/permissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function addShareEditors(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    const { editors } = req.body as { editors: string[] }
    if (!id) {
        return res.status(400).send({ error: 'Missing share id' })
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

    if (!editors || !Array.isArray(editors) || editors.length === 0) {
        return res.status(400).send({ error: 'Editors array is required' })
    }

    try {
        const query = `
            UPDATE shares
            SET editors = (
                SELECT ARRAY(
                    SELECT DISTINCT unnest(editors || $2)
                )
            )
            WHERE id = $1
            RETURNING *
        `

        const result = await run(query, [id, editors])
        if (!result || result.rowCount === 0) {
            return res.status(404).send({ error: `Share ${id} not found` })
        }

        return res.status(200).send(result.rows[0])
    } catch (error) {
        console.error('Error adding editors to share:', error)
        return res.status(500).send({ error: 'Failed to add editors' })
    }
}
