import type { FastifyReply, FastifyRequest } from 'fastify'
import loadSQL from '#utils/loadSQL.ts'
import queryShare from '#utils/share/queryShare.ts'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import buildTree from '#utils/share/buildTree.ts'
import run from '#db'

export default async function getTree(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    const { flat } = req.query as { flat?: boolean } ?? {}
    res.header('Cache-Control', 'no-store')

    try {
        const shareQuery = 'SELECT * FROM shares WHERE id = $1'
        const shareQueryResult = await run(shareQuery, [id])
        let owner = null
        if (!shareQueryResult || !shareQueryResult.rowCount) {
            const user: string = req.headers['id'] as string || ''
            const tokenHeader = req.headers['authorization'] || ''
            if (!tokenHeader) {
                return res.status(404).send({ error: `Share tree ${id} not found` })
            }

            const token = tokenHeader.split(' ')[1] ?? ''
            const { status, id: userId } = await tokenWrapper(user, token, req)

            if (status && userId) {
                owner = userId
            }
        }

        const shareResult = await queryShare(id, owner)
        if (shareResult === 404) {
            throw new Error(`Share ${id} not found`)
        }

        const query = await loadSQL('getFolderTree.sql')
        const result = await run(query, [id])
        if (result.rows.length === 0) {
            return res.status(404).send({ error: `Share ${id} not found` })
        }

        if (flat) {
            return res.send(result.rows)
        }

        const tree = buildTree(result.rows as FileItem[])
        return res.send(tree)
    } catch (error) {
        console.log('Failed to get tree:', error)
        return res.status(500).send({ error: 'Failed to get tree.' })
    }
}
