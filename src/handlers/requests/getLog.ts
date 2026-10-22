import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getRequestLogs(req: FastifyRequest, res: FastifyReply) {
    try {
        const user: string = req.headers['id'] as string || ''
        const tokenHeader = req.headers['authorization'] || ''
        const token = tokenHeader.split(' ')[1] ?? ''
        const { status, id: userId } = await tokenWrapper(user, token, req)
        if (!status || !userId) {
            return res.status(401).send({ error: 'Unauthorized' })
        }

        const { limit = 100, sort } = req.query as { limit?: number; sort?: string }
        const orderBy = sort === 'hits' ? 'hits DESC' : 'last_seen DESC'

        const query = `
            SELECT 
                id,
                domain,
                ip,
                user_agent,
                path,
                method,
                referer,
                hits,
                first_seen,
                last_seen
            FROM request_logs
            ORDER BY ${orderBy}
            LIMIT $1
        `

        const result = await run(query, [limit])

        if (!result || !result.rowCount) {
            return res.status(404).send({ error: 'No request logs found' })
        }

        return res.status(200).send(result.rows)
    } catch (error) {
        console.error('Error fetching request logs:', error)
        return res.status(500).send({ error: 'Failed to fetch request logs' })
    }
}
