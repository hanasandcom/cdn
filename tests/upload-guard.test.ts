import { expect, test } from 'bun:test'
import { beginGuestUpload, beginUpload, maxBulkFiles } from '../src/utils/uploadGuard.ts'

test('standard authenticated uploads are limited to one per second per account', () => {
    const finish = beginUpload('standard-rate-test', { now: 100000 })
    expect(() => beginUpload('standard-rate-test', { now: 100999 })).toThrow('limit')
    finish()
    beginUpload('standard-rate-test', { now: 101000 })()
})

test('guest uploads allow IPv4 and IPv6 but only one in-flight upload and one per second per IP', () => {
    const first = beginGuestUpload('2001:db8::1234', 50_000)
    expect(() => beginGuestUpload('2001:db8::1234', 50_000)).toThrow('already in progress')
    first.finish()
    expect(() => beginGuestUpload('2001:db8::1234', 50_999)).toThrow('limit')
    const next = beginGuestUpload('2001:db8::1234', 51_000)
    next.finish()

    const ipv4 = beginGuestUpload('192.0.2.123', 60_000)
    ipv4.finish()
    expect(() => beginGuestUpload('not-an-ip', 60_000)).toThrow('valid client IP')
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
