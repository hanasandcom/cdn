import pool from './db/pool.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUploadKey(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value)
}

export async function findUploadedKey(owner: string, uploadKey: string) {
    const result = await pool.query<{ id: string, name: string }>(
        'SELECT id,name FROM files WHERE owner=$1 AND upload_key=$2', [owner, uploadKey],
    )
    return result.rows[0]
}
