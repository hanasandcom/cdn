import run from '#db'
import { removeStoredFiles } from './fileStorage.ts'

type PurgingFile = {
    id: string
    storage_key: string | null
    thumbnail_storage_key: string | null
    playback_storage_key: string | null
}

export async function trashMedia(fileId: string, owner: string) {
    return run(`UPDATE files f SET deleted_at=COALESCE(f.deleted_at,NOW()),
        restore_private=f.restore_private OR EXISTS (
            SELECT 1 FROM photo_album_items i JOIN photo_albums a ON a.id=i.album_id
            WHERE i.file_id=f.id AND a.public_token IS NULL)
        WHERE f.id=$1 AND f.owner=$2 AND f.purge_started_at IS NULL
            AND (f.type LIKE 'image/%' OR f.type LIKE 'video/%')
        RETURNING f.id,f.deleted_at,f.deleted_at + INTERVAL '30 days' AS expires_at`, [fileId, owner])
}

export async function restoreMedia(fileId: string, owner: string) {
    return run(`UPDATE files SET deleted_at=NULL
        WHERE id=$1 AND owner=$2 AND deleted_at > NOW() - INTERVAL '30 days'
            AND purge_started_at IS NULL
        RETURNING id`, [fileId, owner])
}

async function finishPurge(file: PurgingFile) {
    await removeStoredFiles([file.storage_key || undefined, file.thumbnail_storage_key || undefined,
        file.playback_storage_key || undefined])
    return run('DELETE FROM files WHERE id=$1 AND purge_started_at IS NOT NULL RETURNING id', [file.id])
}

export async function permanentlyDeleteMedia(fileId: string, owner: string) {
    // Commit the marker before removing bytes: a partial filesystem failure must
    // never make an incomplete original restorable. The expiry job retries it.
    const result = await run(`UPDATE files SET purge_started_at=COALESCE(purge_started_at,NOW())
        WHERE id=$1 AND owner=$2 AND deleted_at IS NOT NULL
        RETURNING id,storage_key,thumbnail_storage_key,playback_storage_key`, [fileId, owner])
    if (!result.rowCount) return null
    await finishPurge(result.rows[0] as PurgingFile)
    return fileId
}

export async function purgeExpiredTrash(batchSize = 5) {
    const limit = Number.isFinite(batchSize) ? Math.max(1, Math.min(5, Math.floor(batchSize))) : 5
    const result = await run(`WITH candidates AS (
        SELECT id FROM files
        WHERE deleted_at IS NOT NULL
            AND (deleted_at <= NOW() - INTERVAL '30 days' OR purge_started_at IS NOT NULL)
        ORDER BY COALESCE(purge_started_at,deleted_at),id
        LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE files f SET purge_started_at=NOW()
        FROM candidates c WHERE f.id=c.id
        RETURNING f.id,f.storage_key,f.thumbnail_storage_key,f.playback_storage_key`, [limit])
    let deleted = 0
    let failed = 0
    for (const row of result.rows) {
        try { deleted += (await finishPurge(row as PurgingFile)).rowCount || 0 }
        catch (error) {
            failed++
            console.error('Trash cleanup failed', { fileId: row.id, error })
        }
    }
    return { deleted, failed }
}
