import run from '#db'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function unlockProject(req: FastifyRequest, res: FastifyReply) {
    const { alias } = req.params as { alias: string }
    if (!alias) {
        return res.status(400).send({ error: 'Missing alias.' })
    }

    const user: string = req.headers['id'] as string || ''
    const tokenHeader = req.headers['authorization'] || ''
    const token = tokenHeader.split(' ')[1] ?? ''
    const { status, id: userId } = await tokenWrapper(user, token, req)
    if (!status || !userId) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    const allowed = await projectPermissionsWrapper({ userId, projectId: alias })
    if (!allowed.status) {
        return res.status(401).send({ error: 'Unauthorized' })
    }

    try {
        const query = `
            UPDATE shares
            SET locked = FALSE
            WHERE alias = $1
            RETURNING *
        `
        const result = await run(query, [alias])
        if (!result || result.rowCount === 0) {
            return res.status(404).send({ error: `Project ${alias} not found` })
        }

        return res.status(200).send(result.rows[0])
    } catch (error) {
        console.log(`Error unlocking project: ${error}`)
        return res.status(500).send({ error: 'Failed to unlock project' })
    }
}
