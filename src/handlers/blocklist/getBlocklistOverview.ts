import run from '#db'
import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getBlockListOverview(req: FastifyRequest, res: FastifyReply) {
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

        const query = `
            SELECT
                id,
                metric,
                value,
                is_vpn,
                is_proxy,
                is_tor,
                is_relay,
                ip_owner,
                country,
                region,
                city,
                owner,
                created_at,
                updated_at,
                requests
            FROM blocklist
            ORDER BY updated_at DESC
            LIMIT 100
        `

        const result = await run(query)
        if (!result || !result.rowCount) {
            return res.status(200).send([])
        }

        const overview = result.rows.map(row => ({
            id: row.id,
            type: row.metric,
            value: row.value,
            is_vpn: row.is_vpn,
            is_proxy: row.is_proxy,
            is_tor: row.is_tor,
            is_relay: row.is_relay,
            ip_owner: row.ip_owner,
            location: {
                country: row.country,
                region: row.region,
                city: row.city
            },
            owner: row.owner,
            requests: row.requests,
            created_at: row.created_at,
            updated_at: row.updated_at
        }))

        return res.status(200).send(overview)
    } catch (error) {
        console.error('Error fetching blocklist overview:', error)
        return res.status(500).send({ error: 'Failed to fetch blocklist overview' })
    }
}
