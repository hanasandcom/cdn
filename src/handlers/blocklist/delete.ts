import run from '#db'
import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function deleteBlocklist(req: FastifyRequest, res: FastifyReply) {
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

        if (!id) {
            return res.status(400).send({ error: 'Missing blocklist ID' })
        }

        const query = `
            DELETE FROM blocklist
            WHERE id = $1
            RETURNING *
        `
        const result = await run(query, [id])

        if (!result || !result.rowCount) {
            return res.status(404).send({ error: 'Blocklist entry not found' })
        }

        return res.status(200).send({ message: 'Blocklist entry deleted', deleted: result.rows[0] })
    } catch (error) {
        console.error(`Error deleting blocklist entry: ${error}`)
        return res.status(500).send({ error: 'Failed to delete blocklist entry' })
    }
}
