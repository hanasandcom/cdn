import run from '#db'
import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getBlockListForNginx(req: FastifyRequest, res: FastifyReply) {
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

        const query = 'SELECT metric AS type, value FROM blocklist'
        const result = await run(query)
        if (!result || !result.rowCount) {
            return res.status(200).send([])
        }

        const entries = result.rows.map(row => ({
            type: row.type,
            value: row.value
        }))

        return res.status(200).send(entries)
    } catch (error) {
        console.error(`Error fetching blocklist for Nginx: ${error}`)
        return res.status(500).send({ error: 'Failed to fetch blocklist' })
    }
}
