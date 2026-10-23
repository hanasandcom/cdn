import { withClient } from '#db'

export default async function ensureSchema() {
    await withClient(async (client) => {
        await client.query(`
            CREATE TABLE IF NOT EXISTS request_metric_totals (
                metric_type TEXT NOT NULL CHECK (metric_type IN ('path', 'ip', 'user_agent', 'domain')),
                metric_value TEXT NOT NULL,
                hits_total BIGINT NOT NULL DEFAULT 0,
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (metric_type, metric_value)
            );

            CREATE TABLE IF NOT EXISTS request_metric_recent_hourly (
                metric_type TEXT NOT NULL CHECK (metric_type IN ('path', 'ip', 'user_agent', 'domain')),
                metric_value TEXT NOT NULL,
                bucket TIMESTAMPTZ NOT NULL,
                hits BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (metric_type, metric_value, bucket)
            );

            CREATE TABLE IF NOT EXISTS request_metric_live_tps (
                domain TEXT NOT NULL,
                bucket TIMESTAMPTZ NOT NULL,
                hits BIGINT NOT NULL DEFAULT 0,
                PRIMARY KEY (domain, bucket)
            );

            DO $migration$
            DECLARE target TEXT;
            BEGIN
                FOREACH target IN ARRAY ARRAY['request_metric_totals', 'request_metric_recent_hourly'] LOOP
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                        WHERE conrelid=target::regclass AND conname=target || '_metric_type_check'
                            AND convalidated AND pg_get_constraintdef(oid) LIKE '%''domain''%') THEN
                        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', target, target || '_metric_type_check');
                        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK '
                            || '(metric_type IN (''path'',''ip'',''user_agent'',''domain''))',
                            target, target || '_metric_type_check');
                    END IF;
                END LOOP;
            END $migration$;

            CREATE TABLE IF NOT EXISTS request_metric_relations (
                primary_type TEXT NOT NULL CHECK (primary_type IN ('ip', 'user_agent')),
                primary_value TEXT NOT NULL,
                relation_type TEXT NOT NULL CHECK (relation_type IN ('path', 'ip', 'user_agent')),
                relation_value TEXT NOT NULL,
                hits_total BIGINT NOT NULL DEFAULT 0,
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (primary_type, primary_value, relation_type, relation_value)
            );
        `)

        await client.query(`
            ALTER TABLE files ADD COLUMN IF NOT EXISTS owner TEXT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS upload_key TEXT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_key TEXT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_size BIGINT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_storage_key TEXT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_size BIGINT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS thumbnail_processed BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS photo_taken_at TIMESTAMPTZ;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS photo_taken_offset_minutes SMALLINT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT FALSE;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS location_label TEXT;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
            ALTER TABLE files ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

            CREATE TABLE IF NOT EXISTS photo_albums (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
                public_token TEXT UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS photo_album_members (
                album_id TEXT NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'contributor')),
                added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (album_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS photo_album_items (
                album_id TEXT NOT NULL REFERENCES photo_albums(id) ON DELETE CASCADE,
                file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                added_by TEXT NOT NULL,
                added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (album_id, file_id)
            );

            CREATE INDEX IF NOT EXISTS idx_photo_albums_owner_updated
            ON photo_albums(owner, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_photo_album_members_user
            ON photo_album_members(user_id, album_id);
            CREATE INDEX IF NOT EXISTS idx_photo_album_items_album_added
            ON photo_album_items(album_id, added_at DESC);
            CREATE INDEX IF NOT EXISTS idx_files_owner_taken
            ON files(owner, photo_taken_at DESC);

            CREATE INDEX IF NOT EXISTS idx_files_owner_uploaded_at
            ON files(owner, uploaded_at DESC);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_files_owner_upload_key
            ON files(owner, upload_key) WHERE upload_key IS NOT NULL;

            CREATE UNIQUE INDEX IF NOT EXISTS idx_request_logs_identity
            ON request_logs(domain, ip, user_agent, path);

            CREATE INDEX IF NOT EXISTS idx_request_logs_last_seen
            ON request_logs(last_seen DESC);

            CREATE INDEX IF NOT EXISTS idx_request_logs_domain
            ON request_logs(domain);

            CREATE INDEX IF NOT EXISTS idx_request_logs_all_last_seen
            ON request_logs_all(last_seen DESC);

            CREATE INDEX IF NOT EXISTS idx_request_logs_all_domain
            ON request_logs_all(domain);

            CREATE INDEX IF NOT EXISTS idx_request_metric_totals_lookup
            ON request_metric_totals(metric_type, hits_total DESC, metric_value);

            CREATE INDEX IF NOT EXISTS idx_request_metric_recent_hourly_lookup
            ON request_metric_recent_hourly(metric_type, bucket DESC, metric_value);

            CREATE INDEX IF NOT EXISTS idx_request_metric_relations_lookup
            ON request_metric_relations(primary_type, primary_value, relation_type, hits_total DESC, relation_value);

            CREATE INDEX IF NOT EXISTS idx_request_metric_live_tps_bucket
            ON request_metric_live_tps(bucket DESC);
        `)

        const totals = await client.query<{ populated: boolean }>('SELECT EXISTS(SELECT 1 FROM request_metric_totals) AS populated')

        if (!totals.rows[0].populated) {
            await client.query(`
                WITH combined AS (
                    SELECT ip::text AS ip, user_agent, path, hits, last_seen
                    FROM request_logs_all
                    UNION ALL
                    SELECT ip::text AS ip, user_agent, path, hits, last_seen
                    FROM request_logs
                ),
                metric_rows AS (
                    SELECT 'path'::text AS metric_type, path AS metric_value, SUM(hits)::bigint AS hits_total, MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY path
                    UNION ALL
                    SELECT 'ip'::text AS metric_type, ip AS metric_value, SUM(hits)::bigint AS hits_total, MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY ip
                    UNION ALL
                    SELECT
                        'user_agent'::text AS metric_type,
                        user_agent AS metric_value,
                        SUM(hits)::bigint AS hits_total,
                        MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY user_agent
                )
                INSERT INTO request_metric_totals (metric_type, metric_value, hits_total, last_seen)
                SELECT metric_type, metric_value, hits_total, last_seen
                FROM metric_rows
                ON CONFLICT (metric_type, metric_value)
                DO UPDATE SET
                    hits_total = EXCLUDED.hits_total,
                    last_seen = GREATEST(request_metric_totals.last_seen, EXCLUDED.last_seen);
            `)

            await client.query(`
                WITH combined AS (
                    SELECT ip::text AS ip, user_agent, path, hits, date_trunc('hour', last_seen) AS bucket
                    FROM request_logs_all
                    WHERE last_seen >= NOW() - INTERVAL '8 days'
                    UNION ALL
                    SELECT ip::text AS ip, user_agent, path, hits, date_trunc('hour', last_seen) AS bucket
                    FROM request_logs
                    WHERE last_seen >= NOW() - INTERVAL '8 days'
                ),
                hourly_rows AS (
                    SELECT 'path'::text AS metric_type, path AS metric_value, bucket, SUM(hits)::bigint AS hits
                    FROM combined
                    GROUP BY path, bucket
                    UNION ALL
                    SELECT 'ip'::text AS metric_type, ip AS metric_value, bucket, SUM(hits)::bigint AS hits
                    FROM combined
                    GROUP BY ip, bucket
                    UNION ALL
                    SELECT 'user_agent'::text AS metric_type, user_agent AS metric_value, bucket, SUM(hits)::bigint AS hits
                    FROM combined
                    GROUP BY user_agent, bucket
                )
                INSERT INTO request_metric_recent_hourly (metric_type, metric_value, bucket, hits)
                SELECT metric_type, metric_value, bucket, hits
                FROM hourly_rows
                ON CONFLICT (metric_type, metric_value, bucket)
                DO UPDATE SET hits = EXCLUDED.hits;
            `)

            await client.query(`
                WITH combined AS (
                    SELECT ip::text AS ip, user_agent, path, hits, last_seen
                    FROM request_logs_all
                    UNION ALL
                    SELECT ip::text AS ip, user_agent, path, hits, last_seen
                    FROM request_logs
                ),
                relation_rows AS (
                    SELECT
                        'ip'::text AS primary_type,
                        ip AS primary_value,
                        'path'::text AS relation_type,
                        path AS relation_value,
                        SUM(hits)::bigint AS hits_total,
                        MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY ip, path
                    UNION ALL
                    SELECT
                        'ip'::text AS primary_type,
                        ip AS primary_value,
                        'user_agent'::text AS relation_type,
                        user_agent AS relation_value,
                        SUM(hits)::bigint AS hits_total,
                        MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY ip, user_agent
                    UNION ALL
                    SELECT
                        'user_agent'::text AS primary_type,
                        user_agent AS primary_value,
                        'path'::text AS relation_type,
                        path AS relation_value,
                        SUM(hits)::bigint AS hits_total,
                        MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY user_agent, path
                    UNION ALL
                    SELECT
                        'user_agent'::text AS primary_type,
                        user_agent AS primary_value,
                        'ip'::text AS relation_type,
                        ip AS relation_value,
                        SUM(hits)::bigint AS hits_total,
                        MAX(last_seen) AS last_seen
                    FROM combined
                    GROUP BY user_agent, ip
                )
                INSERT INTO request_metric_relations (primary_type, primary_value, relation_type, relation_value, hits_total, last_seen)
                SELECT primary_type, primary_value, relation_type, relation_value, hits_total, last_seen
                FROM relation_rows
                ON CONFLICT (primary_type, primary_value, relation_type, relation_value)
                DO UPDATE SET
                    hits_total = EXCLUDED.hits_total,
                    last_seen = GREATEST(request_metric_relations.last_seen, EXCLUDED.last_seen);
            `)
        }

        const populated = await client.query<{ domain: boolean, hourly: boolean, live: boolean }>(`
            SELECT EXISTS(SELECT 1 FROM request_metric_totals WHERE metric_type='domain') AS domain,
                EXISTS(SELECT 1 FROM request_metric_recent_hourly WHERE metric_type='domain') AS hourly,
                EXISTS(SELECT 1 FROM request_metric_live_tps) AS live
        `)
        // updateRollups maintains these tables with each request. Rebuilding them
        // on every restart scans the full archive and blocks the HTTP listener.
        if (!populated.rows[0].domain) await client.query(`
            WITH combined AS (
                SELECT domain, hits, last_seen
                FROM request_logs_all
                UNION ALL
                SELECT domain, hits, last_seen
                FROM request_logs
            )
            INSERT INTO request_metric_totals (metric_type, metric_value, hits_total, last_seen)
            SELECT
                'domain'::text AS metric_type,
                domain AS metric_value,
                SUM(hits)::bigint AS hits_total,
                MAX(last_seen) AS last_seen
            FROM combined
            GROUP BY domain
            ON CONFLICT (metric_type, metric_value)
            DO UPDATE SET
                hits_total = EXCLUDED.hits_total,
                last_seen = GREATEST(request_metric_totals.last_seen, EXCLUDED.last_seen);
        `)

        if (!populated.rows[0].hourly) await client.query(`
            WITH combined AS (
                SELECT domain, hits, date_trunc('hour', last_seen) AS bucket
                FROM request_logs_all
                WHERE last_seen >= NOW() - INTERVAL '8 days'
                UNION ALL
                SELECT domain, hits, date_trunc('hour', last_seen) AS bucket
                FROM request_logs
                WHERE last_seen >= NOW() - INTERVAL '8 days'
            )
            INSERT INTO request_metric_recent_hourly (metric_type, metric_value, bucket, hits)
            SELECT
                'domain'::text AS metric_type,
                domain AS metric_value,
                bucket,
                SUM(hits)::bigint AS hits
            FROM combined
            GROUP BY domain, bucket
            ON CONFLICT (metric_type, metric_value, bucket)
            DO UPDATE SET hits = EXCLUDED.hits;
        `)

        if (!populated.rows[0].live) await client.query(`
            WITH live AS (
                SELECT
                    domain,
                    to_timestamp(FLOOR(EXTRACT(EPOCH FROM last_seen) / 5) * 5) AS bucket,
                    SUM(hits)::bigint AS hits
                FROM request_logs
                WHERE last_seen >= NOW() - INTERVAL '2 days'
                GROUP BY domain, bucket
            )
            INSERT INTO request_metric_live_tps (domain, bucket, hits)
            SELECT domain, bucket, hits
            FROM live
            ON CONFLICT (domain, bucket)
            DO UPDATE SET hits = EXCLUDED.hits;
        `)

        await client.query(`
            DELETE FROM request_metric_recent_hourly
            WHERE bucket < date_trunc('hour', NOW()) - INTERVAL '8 days';
        `)

        await client.query(`
            DELETE FROM request_metric_live_tps
            WHERE bucket < NOW() - INTERVAL '2 days';
        `)
    })
}
