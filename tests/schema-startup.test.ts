import { expect, mock, test } from 'bun:test'
let populated = true
const statements: string[] = []
mock.module('#db', () => ({ withClient: async (work: (client: unknown) => Promise<void>) => work({ query: async (sql: string) => {
    statements.push(sql)
    if (sql.includes('AS populated')) return { rows: [{ populated: true }] }
    if (sql.includes('SELECT EXISTS')) return { rows: [{ domain: populated, hourly: populated, live: populated }] }
    return { rows: [] }
} }) }))
const { default: ensureSchema } = await import('../src/utils/schema.ts')
test('normal restarts keep maintained totals without scanning the archive', async () => {
    await ensureSchema()
    expect(statements.some(sql => sql.includes('WITH combined') || sql.includes('WITH live'))).toBe(false)
    expect(statements.some(sql => sql.includes('DELETE FROM request_metric_live_tps'))).toBe(true)
    expect(statements.some(sql => sql.includes('DROP INDEX'))).toBe(false)
    expect(statements.some(sql => sql.includes('ALTER TABLE files ADD COLUMN IF NOT EXISTS upload_key TEXT'))).toBe(true)
    expect(statements.some(sql => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_files_owner_upload_key'))).toBe(true)
    expect(statements.some(sql => sql.includes('convalidated AND pg_get_constraintdef'))).toBe(true)
})
test('initial bootstrap still fills missing domain and live aggregates', async () => {
    statements.length = 0
    populated = false
    await ensureSchema()
    expect(statements.filter(sql => sql.includes('WITH combined')).length).toBe(2)
    expect(statements.filter(sql => sql.includes('WITH live')).length).toBe(1)
})
