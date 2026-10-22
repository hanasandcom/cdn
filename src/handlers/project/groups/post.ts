import run from '#db'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'

export default async function createProjectGroup(req: FastifyRequest, res: FastifyReply) {
    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const { name, description } = req.body as { name: string; description?: string; owner: string }
    if (!name) {
        return res.status(400).send({ error: 'Name and owner are required' })
    }

    try {
        const id = randomUUID()
        const query = `
            INSERT INTO project_groups (id, name, description, owner)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `
        const result = await run(query, [id, name, description || null, userId])
        return res.status(201).send(result.rows[0])
    } catch (error) {
        console.error('Failed to create project group:', error)
        return res.status(500).send({ error: 'Failed to create project group' })
    }
}
