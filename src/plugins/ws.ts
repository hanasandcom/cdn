import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import registerClient from '#utils/ws/registerClient.ts'
import removeClient from '#utils/ws/removeClient.ts'
import handleShareMessage from '#utils/ws/handleShareMessage.ts'

export default fp(async function wsSharePlugin(fastify: FastifyInstance) {
    fastify.register(async function (fastify) {
        fastify.get('/api/ws/share/:id', { websocket: true }, (connection, req: FastifyRequest) => {
            const id = (req.params as { id: string }).id

            registerClient(id, connection)
            connection.on('message', message => {
                handleShareMessage(id, connection, message)
            })

            connection.on('error', (error) => {
                console.log(`Connection error: ${error}`)
            })

            connection.on('close', () => {
                removeClient(id, connection)
            })
        })

        fastify.get('/api/ws/tps/:id', { websocket: true }, async (connection, req: FastifyRequest) => {
            const { id } = req.params as { id: string }
            registerClient(id, connection)

            try {
                const interval = setInterval(async () => {
                    try {
                        const domains = JSON.parse(fastify.cachedTPS.data.toString())
                        connection.send(JSON.stringify({ type: 'update', data: domains }))
                    } catch (error) {
                        console.error('Error fetching domain TPS:', error)
                    }
                }, 2000)

                connection.on('close', () => {
                    clearInterval(interval)
                    removeClient(id, connection)
                })

                connection.on('error', (error) => {
                    clearInterval(interval)
                    removeClient(id, connection)
                    console.log('WebSocket error:', error)
                })
            } catch (error) {
                console.error('WebSocket setup error:', error)
                connection.send(JSON.stringify({ error: 'Failed to start domain TPS websocket' }))
            }
        })

    })
})
