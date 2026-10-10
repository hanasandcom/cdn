import { trafficPool } from '#utils/db/pool.ts'

type UpdateRollupsProps = {
    domain: string
    ip: string
    user_agent: string
    path: string
}

export default async function updateRollups({ domain, ip, user_agent, path }: UpdateRollupsProps) {
    const client = await trafficPool.connect()
    try {
        await client.query('BEGIN')

        const bucket = new Date()
        bucket.setMinutes(0, 0, 0)
        const bucketISO = bucket.toISOString()
        const liveBucket = new Date(Math.floor(Date.now() / 5000) * 5000).toISOString()

        // Keep conflict rows in a stable order while batching each aggregate
        // table into one statement. Traffic writes use a small dedicated pool
        // so they cannot consume every connection needed by core CDN requests.
        await client.query(`
            INSERT INTO request_metric_totals (metric_type, metric_value, hits_total, last_seen)
            VALUES ('domain', $1, 1, NOW()), ('path', $2, 1, NOW()),
                ('ip', $3, 1, NOW()), ('user_agent', $4, 1, NOW())
            ON CONFLICT (metric_type, metric_value)
            DO UPDATE SET hits_total = request_metric_totals.hits_total + EXCLUDED.hits_total,
                last_seen = NOW()
        `, [domain, path, ip, user_agent])

        await client.query(`
            INSERT INTO request_metric_recent_hourly (metric_type, metric_value, bucket, hits)
            VALUES ('domain', $1, $5, 1), ('path', $2, $5, 1),
                ('ip', $3, $5, 1), ('user_agent', $4, $5, 1)
            ON CONFLICT (metric_type, metric_value, bucket)
            DO UPDATE SET hits = request_metric_recent_hourly.hits + EXCLUDED.hits
        `, [domain, path, ip, user_agent, bucketISO])

        await client.query(`
            INSERT INTO request_metric_live_tps (domain, bucket, hits)
            VALUES ($1, $2, 1)
            ON CONFLICT (domain, bucket)
            DO UPDATE SET hits = request_metric_live_tps.hits + EXCLUDED.hits
        `, [domain, liveBucket])

        await client.query(`
            INSERT INTO request_metric_relations (
                primary_type, primary_value, relation_type, relation_value, hits_total, last_seen
            )
            VALUES ('ip', $1, 'path', $3, 1, NOW()), ('ip', $1, 'user_agent', $4, 1, NOW()),
                ('user_agent', $2, 'path', $3, 1, NOW()), ('user_agent', $2, 'ip', $1, 1, NOW())
            ON CONFLICT (primary_type, primary_value, relation_type, relation_value)
            DO UPDATE SET hits_total = request_metric_relations.hits_total + EXCLUDED.hits_total,
                last_seen = NOW()
        `, [ip, user_agent, path, user_agent])

        await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
    } finally {
        client.release()
    }
}
