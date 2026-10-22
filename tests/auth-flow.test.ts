import { afterEach, describe, expect, test } from 'bun:test'
import { getPasskeyOptions, postPasskeyVerify, postSocialStart, postSsoStart } from '../src/handlers/auth/identityFlow.ts'
import getTargetRouteGroup from '../src/utils/rateLimit/getTargetRouteGroup.ts'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function request(overrides: Record<string, unknown> = {}) {
    return {
        id: 'req-test',
        ip: '203.0.113.4',
        protocol: 'https',
        method: 'POST',
        headers: {
            host: 'cdn.hanasand.com',
            origin: 'https://cdn.hanasand.com',
            'user-agent': 'test-browser',
            'x-device-public-jwk': '{"kty":"EC"}',
            dpop: 'proof.jwt',
        },
        params: {},
        query: {},
        ...overrides,
    }
}

function reply() {
    const headers: Record<string, string | string[]> = {}
    let statusCode = 200
    let payload: unknown
    const result = {
        headers,
        get statusCode() { return statusCode },
        get payload() { return payload },
        header(name: string, value: string | string[]) { headers[name] = value; return result },
        status(value: number) { statusCode = value; return result },
        send(value: unknown) { payload = value; return result },
    }
    return result
}

describe('CDN Identity login proxies', () => {
    test('forwards passkey options through the fixed Identity route', async () => {
        let called = ''
        globalThis.fetch = (async (input, init) => {
            called = String(input)
            expect(init?.method).toBe('GET')
            expect(init?.redirect).toBe('error')
            return Response.json({ challengeId: 'challenge', publicKey: { rpId: 'hanasand.com' } })
        }) as typeof fetch
        const res = reply()

        await getPasskeyOptions(request({ method: 'GET', query: { username: 'eirik' } }) as never, res as never)

        expect(called).toEndWith('/auth/passkeys/authenticate/options?username=eirik')
        expect(res.payload).toEqual({ challengeId: 'challenge', publicKey: { rpId: 'hanasand.com' } })
        expect(res.headers['Cache-Control']).toBe('no-store')
    })

    test('sets shared cookies after Identity verifies a passkey without returning the token', async () => {
        let sent: Record<string, unknown> | undefined
        let forwarded = false
        globalThis.fetch = (async (_input, init) => {
            sent = JSON.parse(String(init?.body))
            const headers = init?.headers as Record<string, string>
            forwarded = headers.DPoP === 'proof.jwt' && headers['x-device-public-jwk'] === '{"kty":"EC"}'
            return Response.json({
                id: 'eirik', name: 'Eirik', avatar: '', token: 'secret-token',
                expires_at: '2026-10-22T20:00:00.000Z',
            })
        }) as typeof fetch
        const res = reply()

        await postPasskeyVerify(request({ body: { challengeId: 'challenge', credential: { id: 'credential' } } }) as never, res as never)

        expect(sent).toEqual({ challengeId: 'challenge', credential: { id: 'credential' } })
        expect(forwarded).toBe(true)
        expect(res.payload).toEqual({ id: 'eirik', name: 'Eirik' })
        expect(JSON.stringify(res.payload)).not.toContain('secret-token')
        const cookies = res.headers['Set-Cookie'] as string[]
        expect(cookies.some(cookie => cookie.startsWith('access_token=secret-token'))).toBe(true)
        expect(cookies.every(cookie => cookie.includes('Domain=.hanasand.com'))).toBe(true)
    })

    test('rejects cross-origin POSTs before contacting Identity', async () => {
        let calls = 0
        globalThis.fetch = (async () => { calls++; return Response.json({ url: 'https://idp.example.test' }) }) as typeof fetch
        const res = reply()

        await postSsoStart(request({ headers: { host: 'cdn.hanasand.com', origin: 'https://attacker.example' }, body: { binding: 'a'.repeat(43) } }) as never, res as never)

        expect(calls).toBe(0)
        expect(res.statusCode).toBe(403)
    })

    test('rejects unsafe provider redirects and unknown providers', async () => {
        let sent: Record<string, unknown> | undefined
        globalThis.fetch = (async (_input, init) => {
            sent = JSON.parse(String(init?.body))
            return Response.json({ url: 'https://idp.example.test/authorize' })
        }) as typeof fetch
        const ssoReply = reply()
        await postSsoStart(request({ body: { binding: 'a'.repeat(43), redirectPath: '//attacker.example/' } }) as never, ssoReply as never)
        expect(sent?.redirectPath).toBe('https://cdn.hanasand.com/gallery')

        await postSsoStart(request({ body: { binding: 'a'.repeat(43), redirectPath: '/photos?sort=date' } }) as never, reply() as never)
        expect(sent?.redirectPath).toBe('https://cdn.hanasand.com/photos?sort=date')

        const badProvider = reply()
        await postSocialStart(request({ params: { provider: 'https://attacker.example' }, body: { binding: 'a'.repeat(43) } }) as never, badProvider as never)
        expect(badProvider.statusCode).toBe(404)
    })

    test('binds SSO in a short-lived shared HttpOnly cookie before returning the provider URL', async () => {
        const binding = 'b'.repeat(43)
        globalThis.fetch = (async () => Response.json({ url: 'https://idp.example.test/authorize' })) as typeof fetch
        const res = reply()

        await postSsoStart(request({ body: { binding, redirectPath: '/gallery' } }) as never, res as never)

        expect(res.payload).toEqual({ url: 'https://idp.example.test/authorize' })
        expect(res.headers['Set-Cookie']).toBe(
            `hanasand_auth_binding=${binding}; Max-Age=600; Path=/; SameSite=Lax; HttpOnly; Secure; Domain=.hanasand.com`,
        )
    })

    test('puts all sign-in API paths under route rate limits', () => {
        expect(getTargetRouteGroup('/api/auth/passkeys/authenticate/options')).toBe('/api/auth/passkeys/authenticate/')
        expect(getTargetRouteGroup('/api/auth/passkeys/authenticate/verify')).toBe('/api/auth/passkeys/authenticate/')
        expect(getTargetRouteGroup('/api/auth/sso/start')).toBe('/api/auth/sso/start')
        expect(getTargetRouteGroup('/api/auth/social/google/start')).toBe('/api/auth/social/')
    })
})
