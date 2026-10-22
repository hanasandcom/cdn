import run from '#db'
import hasRole from '#utils/auth/hasRole.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function putBlockList(req: FastifyRequest, res: FastifyReply) {
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
        const updates = req.body as Partial<{
            metric: string
            value: string
            vpn: boolean
            proxy: boolean
            tor: boolean
            owner: string
            country: string
            region: string
            city: string
            hits: Record<string, number>[]
        }>

        if (!id) {
            return res.status(400).send({ error: 'Missing blocklist entry ID' })
        }

        const setClauses: string[] = []
        const params: SQLParamType = []

        Object.entries(updates).forEach(([key, val]) => {
            const normalizedValue = key === 'hits'
                ? JSON.stringify(val)
                : (val as string | number | boolean | string[] | Date | Buffer | null)
            params.push(normalizedValue)
            setClauses.push(`${key} = $${params.length}`)
        })

        if (!setClauses.length) {
            return res.status(400).send({ error: 'No fields provided to update' })
        }

        params.push(id)
        const query = `
            UPDATE blocklist
            SET ${setClauses.join(', ')}, updated_at = NOW()
            WHERE id = $${params.length}
            RETURNING *
        `

        const result = await run(query, params)

        if (!result || !result.rowCount) {
            return res.status(404).send({ error: 'Blocklist entry not found' })
        }

        return res.status(200).send(result.rows[0])
    } catch (error) {
        console.error(`Error updating blocklist entry: ${error}`)
        return res.status(500).send({ error: 'Failed to update blocklist entry' })
    }
}
