import run from '#db'
import queryAlias from '#utils/share/queryAlias.ts'
import loadSQL from '#utils/loadSQL.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import projectPermissionsWrapper from '#utils/auth/projectPermissionsWrapper.ts'

export default async function deleteProject(req: FastifyRequest, res: FastifyReply) {
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
        const result = await queryAlias(alias)
        if (!result || result.rows.length <= 1) {
            return res.status(404).send({ error: `Project ${alias} not found` })
        }

        const root = result.rows[0]
        const treeQuery = await loadSQL('getFolderTree.sql')
        const treeResult = await run(treeQuery, [root.id])
        if (treeResult.rows.length === 0) {
            return res.status(404).send({ error: `Project ${alias} not found` })
        }

        const allIds = treeResult.rows.map(r => r.id)
        const deleteQuery = 'DELETE FROM shares WHERE id = ANY($1::text[])'
        await run(deleteQuery, [allIds])

        return res.status(200).send({ deleted: allIds })
    } catch (error) {
        console.log('Error deleting project', error)
        return res.status(500).send({ error: 'Failed to delete project' })
    }
}
