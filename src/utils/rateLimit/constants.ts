import type { ClientClass, LimitProfile } from './types.ts'

export const REQUEST_WINDOW_MS = 60_000
export const MISS_WINDOW_MS = 60_000
export const CLEANUP_INTERVAL_MS = 5 * 60_000

export const TARGET_ROUTE_GROUPS = [
    '/api/auth/login-form.js',
    '/api/auth/device-proof-client.js',
    '/api/auth/device-proof',
    '/api/auth/device-proof.js',
    '/api/auth/device-proof/origins',
    '/api/auth/passkeys/authenticate/',
    '/api/auth/social/providers',
    '/api/auth/social/',
    '/api/auth/sso/start',
    '/api/albums/public/',
    '/api/share/',
    '/api/files/path/',
    '/api/files/',
    '/api/files/check',
]

export const LIMITS: Record<ClientClass, LimitProfile> = {
    first_party_browser: {
        requestsPerMinute: 600,
        missesPerMinute: 180,
    },
    trusted_api: {
        requestsPerMinute: 240,
        missesPerMinute: 60,
    },
    external: {
        requestsPerMinute: 24,
        missesPerMinute: 8,
    },
}
