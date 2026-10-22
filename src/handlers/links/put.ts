import run from '#db'
import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function putLink(req: FastifyRequest, res: FastifyReply) {
    try {
        const user: string = req.headers['id'] as string || ''
        const tokenHeader = req.headers['authorization'] || ''
        const token = tokenHeader.split(' ')[1] ?? ''
        const { status, id: userId } = await tokenWrapper(user, token, req)
        if (!status || !userId) {
            return res.status(401).send({ error: 'Unauthorized' })
        }

        const allowed = await hasRole({ id: userId, role: 'system_admin', token })
        if (!allowed) {
            return res.status(401).send({ error: 'Unauthorized' })
        }

        const { id } = req.params as { id: string }
        const { path } = req.body as { path?: string }

        if (!id) {
            return res.status(400).send({ error: 'Missing link ID' })
        }

        const query = `
            UPDATE links
            SET
                path = COALESCE($2, path),
            WHERE id = $1
            RETURNING *
        `
        const result = await run(query, [id, path || null])

        if (!result || result.rowCount === 0) {
            return res.status(404).send({ error: 'Link not found' })
        }

        return res.status(200).send(result.rows[0])
    } catch (error) {
        console.log(`Error updating shortcut: ${error}`)
        return res.status(500).send({ error: 'Failed to update shortcut' })
    }
}
