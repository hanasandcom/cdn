import { expect, test } from 'bun:test'
import { beginUpload, maxBulkFiles } from '../src/utils/uploadGuard.ts'

test('standard authenticated uploads are limited to one per second per account', () => {
    const finish = beginUpload('standard-rate-test', { now: 100000 })
    expect(() => beginUpload('standard-rate-test', { now: 100999 })).toThrow('limit')
    finish()
    beginUpload('standard-rate-test', { now: 101000 })()
})

test('authenticated bulk uploads are limited to 5000 files per second per account', () => {
    const finish = beginUpload('bulk-rate-test', { fileCount: maxBulkFiles, mode: 'bulk', now: 200000 })
    expect(() => beginUpload('bulk-rate-test', { mode: 'bulk', now: 200000 })).toThrow('limit')
    finish()
    beginUpload('bulk-rate-test', { mode: 'bulk', now: 201000 })()
})

test('bulk uploads reject invalid or oversized batches before reserving capacity', () => {
    expect(() => beginUpload('invalid-batch-test', { fileCount: 0, mode: 'bulk' })).toThrow('Invalid upload size')
    expect(() => beginUpload('oversized-batch-test', { fileCount: maxBulkFiles + 1, mode: 'bulk' })).toThrow('Invalid upload size')
    expect(() => beginUpload('', { mode: 'bulk' })).toThrow('Sign in')
})

test('uploads retain the service-wide four-request concurrency cap', () => {
    const finishes = Array.from({ length: 4 }, (_, index) => beginUpload(`parallel-rate-test-${index}`))
    expect(() => beginUpload('parallel-rate-test-overflow')).toThrow('busy')
    finishes.forEach(finish => finish())
})
