import cors from '@fastify/cors'
import Fastify from 'fastify'
import routes from './routes.ts'
import health from './handlers/index/health.ts'
import { prepareStorage } from '#utils/fileStorage.ts'
import getIndex from './handlers/index/get.ts'
import {
    getExifReaderScript,
    getGalleryPage,
    getGalleryClientScript,
    getAuthClientScript,
    getAuthClientStylesheet,
    getLoginPage,
    getUploadPage,
    getUploadPickerScript,
    getBulkUploadScript,
    getSharedAlbumPage,
} from './handlers/index/staticPages.ts'
import login from './handlers/auth/login.ts'
import {
    getPasskeyOptions,
    getSsoStart,
    getSocialProviders,
    postPasskeyVerify,
    postSocialStart,
    postSsoStart,
} from './handlers/auth/identityFlow.ts'
import getSession from './handlers/auth/session.ts'
import logout from './handlers/auth/logout.ts'
import redirectLegacyFile from './handlers/files/redirectLegacy.ts'
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
fastify.get('/assets/exifreader.js', getExifReaderScript)
fastify.get('/assets/upload-picker.js', getUploadPickerScript)
fastify.get('/assets/bulk-upload.js', getBulkUploadScript)
fastify.get('/assets/gallery.js', getGalleryClientScript)
fastify.get('/gallery', getGalleryPage)
fastify.get('/shared/:token', getSharedAlbumPage)
fastify.get('/login', getLoginPage)
fastify.post('/api/auth/login', login)
fastify.get('/api/auth/sso/start', getSsoStart)
fastify.get('/assets/login-form.js', getAuthClientScript)
fastify.get('/assets/login-form.css', getAuthClientStylesheet)
fastify.get('/api/auth/passkeys/authenticate/options', getPasskeyOptions)
fastify.post('/api/auth/passkeys/authenticate/verify', postPasskeyVerify)
fastify.get('/api/auth/social/providers', getSocialProviders)
fastify.post('/api/auth/social/:provider/start', postSocialStart)
fastify.post('/api/auth/sso/start', postSsoStart)
fastify.get('/api/auth/session', getSession)
fastify.get('/logout', logout)
fastify.get('/files/:id', redirectLegacyFile)
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
