import pg from 'pg'
import config from '#constants'

const {
    DB,
    DB_USER,
    DB_HOST,
    DB_PASSWORD,
    DB_PORT,
    DB_MAX_CONN,
    DB_IDLE_TIMEOUT_MS,
    DB_TIMEOUT_MS,
} = config

const { Pool } = pg

// Keep every CDN PostgreSQL connection inside one budget, including bursty
// traffic writes. The default matches the Hanasand API's configured limit.
const maxConnections = Number(DB_MAX_CONN) || 100
const trafficConnections = Math.min(
    Number(process.env.CDN_TRAFFIC_DB_MAX_CONN) || 5,
    Math.max(1, maxConnections - 1),
)
const appConnections = maxConnections - trafficConnections

const poolOptions = {
    user: DB_USER || 'cdn',
    host: DB_HOST,
    database: DB || 'cdn',
    password: DB_PASSWORD,
    port: Number(DB_PORT) || 5432,
    idleTimeoutMillis: Number(DB_IDLE_TIMEOUT_MS) || 5000,
    connectionTimeoutMillis: Number(DB_TIMEOUT_MS) || 3000,
    keepAlive: true,
}

const pool = new Pool({ ...poolOptions, max: appConnections })

// Traffic logging is bursty and lower priority than storage and health checks.
// Keep its writes in a small pool so it cannot occupy every application slot.
export const trafficPool = new Pool({
    ...poolOptions,
    max: trafficConnections,
})

export default pool
