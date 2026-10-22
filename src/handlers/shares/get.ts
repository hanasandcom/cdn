import run from '#db'
import tokenWrapper from '#utils/auth/tokenWrapper.ts'
import estimateReadingTime from '#utils/estimateReadTime.ts'
import queryShare from '#utils/share/queryShare.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getShare(req: FastifyRequest, res: FastifyReply) {
    const { id } = req.params as { id: string }
    res.header('Cache-Control', 'no-store')

    if (!id) {
        return res.status(400).send({ error: 'Missing share ID' })
    }

    try {
        const query = 'SELECT * FROM shares WHERE id = $1'
        let result = await run(query, [id])
        if (!result || !result.rowCount) {
            const user: string = req.headers['id'] as string || ''
            const tokenHeader = req.headers['authorization'] || ''
            if (!tokenHeader) {
                return res.status(404).send({ error: `Share ${id} not found` })
            }

            const token = tokenHeader.split(' ')[1] ?? ''
            const { status, id: userId } = await tokenWrapper(user, token, req)
            let owner = null
            if (status && userId) {
                owner = userId
            }

            const queryResult = await queryShare(id, owner)
            if (queryResult === 404) {
                return res.status(404).send({ error: 'Share not found' })
            }

            result = queryResult
        }

        const data = result.rows[0]
        const readTime = estimateReadingTime(data.content)
        const response = { ...data, ...readTime }
        return res.status(200).send(response)
    } catch (error) {
        console.log(`Share ${id} not found:`, error)
        return res.status(404).send({ error: `Share ${id} not found` })
    }
}
