import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('shared Hanasand auth client bundle', () => {
    test('bundles the published browser registration and stylesheet for local CDN serving', async () => {
        const outdir = await mkdtemp(join(tmpdir(), 'cdn-auth-client-'))
        try {
            const result = await Bun.build({
                entrypoints: ['src/client/auth.ts'],
                outdir,
                target: 'browser',
            })
            expect(result.success).toBe(true)
            expect(result.outputs.map(output => output.path.split('/').at(-1))).toContain('auth.js')
            expect(result.outputs.map(output => output.path.split('/').at(-1))).toContain('auth.css')

            const script = await readFile(join(outdir, 'auth.js'), 'utf8')
            const stylesheet = await readFile(join(outdir, 'auth.css'), 'utf8')
            expect(script).toContain('hanasand-login-form')
            expect(script).toContain('hanasand-authenticated')
            expect(script).toContain('passkeyOptionsUrl')
            expect(script).toContain('Content-Type')
            expect(script).toContain('application/json')
            expect(script).toContain('body: JSON.stringify({ username, password })')
            expect(script).not.toContain('https://hanasand.com/api/auth/sso/start')
            expect(stylesheet).toContain('.hanasand-login-form__provider')
        } finally {
            await rm(outdir, { recursive: true, force: true })
        }
    })
})
