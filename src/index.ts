import cors from '@fastify/cors'
import Fastify from 'fastify'
import routes from './routes.ts'
import health from './handlers/index/health.ts'
import { prepareStorage } from '#utils/fileStorage.ts'
import getIndex from './handlers/index/get.ts'
import { getGalleryPage, getUploadPage } from './handlers/index/staticPages.ts'
import getRobotsTxt from './handlers/index/getRobotsTxt.ts'
import websocketPlugin from '@fastify/websocket'
import fastifyMultipart from '@fastify/multipart'
import ws from './plugins/ws.ts'
import fp from '#utils/refresh/fp.ts'
import ensureSchema from '#utils/schema.ts'
import registerPublicReadRateLimiter from '#utils/rateLimit/publicReadLimiter.ts'
import loadInstallScript from './install/loadInstallScript.ts'
import { randomUUID } from 'node:crypto'
import { accessLog } from './utils/accessLog.ts'

const fastify = Fastify({
    logger: true,
    disableRequestLogging: true,
    genReqId: () => randomUUID(),
    // Only the local Varnish hop may supply a forwarded address.
    trustProxy: ['127.0.0.1', '::1'],
})
fastify.addHook('onResponse', async (req, res) => { req.log.info({ access: accessLog(req, res) }, 'http_access') })

fastify.register(fastifyMultipart, {
    limits: {
        fileSize: 50 * 1024 * 1024
    }
})

fastify.register(cors, {
    origin: (process.env.CDN_CORS_ORIGINS || 'https://hanasand.com,https://www.hanasand.com')
        .split(',').map(origin => origin.trim()).filter(Boolean)
        .concat(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000']),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']
})

const port = Number(process.env.PORT) || 8081

fastify.decorate('install', loadInstallScript())

fastify.decorate('cachedIPMetrics', { status: 200, data: Buffer.from(JSON.stringify([])) })
fastify.decorate('cachedUAMetrics', { status: 200, data: Buffer.from(JSON.stringify([])) })
fastify.decorate('cachedTPS', { status: 200, data: Buffer.from(JSON.stringify([])) })
fastify.decorate('cachedSummary', {
    status: 200, data: {
        path: Buffer.from(JSON.stringify([])),
        ip: Buffer.from(JSON.stringify([])),
        user_agent: Buffer.from(JSON.stringify([])),
        domain: Buffer.from(JSON.stringify([])),
    }
})

fastify.register(websocketPlugin)
registerPublicReadRateLimiter(fastify)
fastify.register(ws, { prefix: '/api' })
fastify.register(routes, { prefix: '/api' })

fastify.get('/', getIndex)
fastify.get('/upload', getUploadPage)
fastify.get('/gallery', getGalleryPage)
fastify.get('/health', health)
fastify.get('/robots.txt', getRobotsTxt)

try {
    await ensureSchema()
    await prepareStorage()
    fastify.register(fp)
    await fastify.listen({ port, host: '0.0.0.0' })
} catch (error) {
    fastify.log.error(error)
    process.exit(1)
}
