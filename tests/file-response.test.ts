import { describe, expect, test } from 'bun:test'
import {
    getExifReaderScript,
    getGalleryClientScript,
    getGalleryPage,
    getLoginPage,
    getUploadPage,
    getUploadPickerScript,
} from '../src/handlers/index/staticPages.ts'
import redirectLegacyFile from '../src/handlers/files/redirectLegacy.ts'
import { fileResponseHeaders } from '../src/utils/fileResponse.ts'
import { setSessionCookies } from '../src/utils/auth/session.ts'
import tokenWrapper from '../src/utils/auth/tokenWrapper.ts'
import getTargetRouteGroup from '../src/utils/rateLimit/getTargetRouteGroup.ts'

async function page(handler: typeof getUploadPage, request = {}) {
    let html = ''
    const headers: Record<string, string> = {}
    const reply = {
        header: (name: string, value: string) => { headers[name] = value; return reply },
        type: () => reply,
        send: (body: string) => { html = body; return body },
    }
    await handler({ headers: {}, ...request } as never, reply as never)
    return { html, headers }
}

async function script(handler: typeof getUploadPickerScript | typeof getGalleryClientScript | typeof getExifReaderScript) {
    let body = ''
    const reply = {
        header: () => reply,
        type: () => reply,
        send: (value: Buffer) => { body = value.toString(); return body },
    }
    await handler({} as never, reply as never)
    return body
}

describe('file response safety', () => {
    test('serves only safe media types inline', () => {
        const image = fileResponseHeaders('photo.png', 'image/png')
        const html = fileResponseHeaders('page.html', 'text/html')

        expect(image['Content-Type']).toBe('image/png')
        expect(image['Content-Disposition']).toStartWith('inline;')
        expect(html['Content-Type']).toBe('application/octet-stream')
        expect(html['Content-Disposition']).toStartWith('attachment;')
    })

    test('sanitizes filenames and disables content sniffing', () => {
        const headers = fileResponseHeaders('bad\r\nname.html', 'text/html')

        expect(headers['Content-Disposition']).not.toContain('\r')
        expect(headers['Content-Disposition']).not.toContain('\n')
        expect(headers['X-Content-Type-Options']).toBe('nosniff')
        expect(headers['Content-Security-Policy']).toContain('sandbox')
    })
})

describe('legacy file links', () => {
    test('redirects the old path to the canonical API URL without caching', async () => {
        let redirect: { url: string, statusCode: number } | undefined
        let cacheControl = ''
        const reply = {
            header: (_name: string, value: string) => { cacheControl = value; return reply },
            redirect: (url: string, statusCode: number) => { redirect = { url, statusCode }; return reply },
        }
        await redirectLegacyFile({ params: { id: 'file id' } } as never, reply as never)
        expect(redirect).toEqual({ url: '/api/files/file%20id', statusCode: 308 })
        expect(cacheControl).toBe('no-store')
    })
})

describe('CDN session cookies', () => {
    test('refreshes the shared session expiry on authenticated CDN requests', () => {
        let cookies: string[] = []
        const reply = {
            header: (name: string, value: string[]) => {
                if (name === 'Set-Cookie') cookies = value
                return reply
            },
        }
        setSessionCookies({
            headers: { host: 'cdn.hanasand.com' },
            protocol: 'https',
        } as never, reply as never, {
            id: 'user-1',
            token: 'session-token',
            expiresAt: '2026-10-21T20:00:00.000Z',
        })

        expect(cookies).toHaveLength(4)
        expect(cookies[0]).toContain('id=user-1')
        expect(cookies[0]).toContain('Domain=.hanasand.com')
        expect(cookies[0]).toContain('Secure')
        expect(cookies[0]).toContain('Expires=Wed, 21 Oct 2026 20:00:00 GMT')
        expect(cookies[1]).toContain('access_token=session-token')
        expect(cookies[2]).toContain('session_expires_at=2026-10-21T20%3A00%3A00.000Z')
    })
})

describe('Identity session checks', () => {
    test('keeps an unavailable Identity API from being treated as a signed-out session', async () => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => new Response('unavailable', { status: 503 })) as typeof fetch

        try {
            await expect(tokenWrapper('user-1', 'session-token')).rejects.toMatchObject({
                statusCode: 503,
                code: 'AUTH_SERVICE_UNAVAILABLE',
            })
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    test('treats an invalid Identity token as signed out', async () => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => new Response('invalid', { status: 401 })) as typeof fetch

        try {
            await expect(tokenWrapper('user-1', 'expired-token')).resolves.toMatchObject({ status: false, id: null })
        } finally {
            globalThis.fetch = originalFetch
        }
    })
})

describe('shared login package assets', () => {
    test('groups only the same-origin package assets under public read limits', () => {
        expect(getTargetRouteGroup('/assets/login-form.js')).toBe('/assets/login-form.js')
        expect(getTargetRouteGroup('/assets/login-form.css')).toBe('/assets/login-form.css')
        expect(getTargetRouteGroup('/assets/login-form.js/extra')).toBeNull()
        expect(getTargetRouteGroup('/api/auth/login-form.js')).toBeNull()
    })

    test('serves the installed package module and stylesheet locally with safe headers', async () => {
        const { createLoginAssetHandlers } = await import('../src/handlers/auth/loginAssets.ts')
        const loaded: string[] = []
        const headers: Record<string, string> = {}
        const bodies: string[] = []
        const reply = {
            header: (name: string, value: string) => { headers[name] = value; return reply },
            type: (value: string) => { headers['Content-Type'] = value; return reply },
            send: (value: string) => { bodies.push(value); return reply },
        }
        const handlers = createLoginAssetHandlers(async specifier => {
            loaded.push(specifier)
            return specifier === 'hanasand/auth'
                ? 'export function registerHanasandLoginForm() {}'
                : '.hanasand-login-form { display: block; }'
        })

        await handlers.getScript({} as never, reply as never)
        expect(bodies[0]).toContain('export function registerHanasandLoginForm() {}')
        expect(bodies[0]).toContain('registerHanasandLoginForm();')
        expect(headers['Cache-Control']).toBe('no-store')
        expect(headers['X-Content-Type-Options']).toBe('nosniff')
        expect(headers['Content-Type']).toBe('text/javascript; charset=utf-8')

        await handlers.getStyles({} as never, reply as never)
        expect(bodies[1]).toBe('.hanasand-login-form { display: block; }')
        expect(headers['Content-Type']).toBe('text/css; charset=utf-8')
        expect(loaded).toEqual(['hanasand/auth', 'hanasand/auth.css'])
    })

    test('resolves the browser form module and stylesheet from the installed package', async () => {
        const { createLoginAssetHandlers } = await import('../src/handlers/auth/loginAssets.ts')
        const bodies: string[] = []
        const reply = {
            header: () => reply,
            type: () => reply,
            send: (value: string) => { bodies.push(value); return reply },
        }
        const handlers = createLoginAssetHandlers()

        await handlers.getScript({} as never, reply as never)
        await handlers.getStyles({} as never, reply as never)

        expect(bodies[0]).toContain('export function registerHanasandLoginForm()')
        expect(bodies[0]).toContain('registerHanasandLoginForm();')
        expect(bodies[0]).toContain('Email or username')
        expect(bodies[0]).toContain('Password')
        expect(bodies[0]).toContain('Sign in with passkey')
        expect(bodies[0]).toContain('Continue with Google')
        expect(bodies[0]).toContain('document.querySelector(\'#cdn-login-form\')')
        expect(bodies[0]).toContain('new FormData(cdnLoginForm)')
        expect(bodies[0]).toContain('fetch(cdnLoginForm.action')
        expect(() => new Function(bodies[0].slice(bodies[0].indexOf('const cdnLoginForm')))).not.toThrow()
        expect(bodies[1]).toContain('hanasand-login-form')
    })

    test('submits the shared login fields to CDN and navigates after success', async () => {
        const { createLoginAssetHandlers } = await import('../src/handlers/auth/loginAssets.ts')
        const bodies: string[] = []
        const reply = {
            header: () => reply,
            type: () => reply,
            send: (value: string) => { bodies.push(value); return reply },
        }
        await createLoginAssetHandlers().getScript({} as never, reply as never)

        let onSubmit: ((event: { preventDefault(): void }) => Promise<void>) | undefined
        const busy: boolean[] = []
        const errors: string[] = []
        const component = {
            setBusy: (value: boolean) => busy.push(value),
            setError: (value: string) => errors.push(value),
            getAttribute: () => '/gallery',
        }
        const form = {
            action: '/api/auth/login',
            addEventListener: (type: string, handler: typeof onSubmit) => {
                expect(type).toBe('submit')
                onSubmit = handler
            },
            querySelector: () => component,
        }
        const fields = { username: 'eirik', password: 'secret' }
        class LoginFormData {
            constructor() {}
            get(name: keyof typeof fields) { return fields[name] }
        }
        let request: { url: string, init: RequestInit } | undefined
        let destination = ''
        const handlerScript = bodies[0].slice(bodies[0].indexOf('const cdnLoginForm'))
        const submit = new Function('document', 'FormData', 'fetch', 'window', handlerScript) as (...args: unknown[]) => void
        submit(
            { querySelector: () => form },
            LoginFormData,
            async (url: string, init: RequestInit) => {
                request = { url, init }
                return { ok: true, json: async () => ({ id: 'user-1' }) }
            },
            { location: { assign: (value: string) => { destination = value } } },
        )

        expect(onSubmit).toBeDefined()
        await onSubmit!({ preventDefault() {} })
        expect(request?.url).toBe('/api/auth/login')
        expect(JSON.parse(String(request?.init.body))).toEqual(fields)
        expect(request?.init.credentials).toBe('same-origin')
        expect(destination).toBe('/gallery')
        expect(busy).toEqual([true, false])
        expect(errors).toEqual([''])
    })
})

describe('standalone CDN pages', () => {
    test('renders the guest state and picker fallback in the initial upload HTML', async () => {
        const { html } = await page(getUploadPage)
        const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        const authScript = scripts[0]?.[1]
        const uploadScript = scripts.at(-1)?.[1]

        expect(authScript).toContain('window.cdnAuth = fetch(\'/api/auth/session\'')
        expect(uploadScript).toBeDefined()
        expect(() => new Function(uploadScript!)).not.toThrow()
        expect(html).toContain('id="upload-hint" class="upload-hint">Sign in to upload multiple files at once.')
        expect(html).toContain('<div class="picker-fallback" aria-hidden="true">')
        expect(html).toContain('picker-fallback-dropzone')
        expect(html).toContain('/api/auth/session')
        expect(html).not.toContain('customElements.whenDefined')
        expect(html).not.toContain('hint.hidden')
    })

    test('upload supports guests while the gallery requires a session', async () => {
        const uploadPage = await page(getUploadPage)
        const galleryPage = await page(getGalleryPage)
        const loginPage = await page(getLoginPage)
        const { html: upload, headers: uploadHeaders } = uploadPage
        const { html: gallery, headers: galleryHeaders } = galleryPage
        const { html: login, headers: loginHeaders } = loginPage
        const galleryClient = await script(getGalleryClientScript)

        const uploadScripts = Array.from(upload.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(uploadScripts.length).toBeGreaterThan(0)
        expect(() => new Function(uploadScripts[uploadScripts.length - 1][1])).not.toThrow()
        expect(upload).toContain('fetch(\'/api/files\'')
        expect(upload).toContain('<hanasand-upload-picker id="picker" multiple')
        expect(upload).not.toContain('class="upload-panel checking-auth"')
        expect(upload).not.toContain('<hanasand-upload-picker id="picker" disabled')
        expect(upload).toContain('id="upload-hint" class="upload-hint">Sign in to upload multiple files at once.')
        expect(upload).toContain('.upload-actions { display: flex; align-items: center; justify-content: space-between;')
        expect(upload.indexOf('id="upload-hint"')).toBeLessThan(upload.indexOf('<button class="upload-submit"'))
        expect(upload).not.toContain('customElements.whenDefined')
        expect(upload).not.toContain('hint.hidden')
        expect(upload).not.toContain('status.textContent = \'Sign-in could not be checked. Reload to try again.\'')
        expect(upload).not.toContain('Checking session')
        const submitScript = uploadScripts[uploadScripts.length - 1][1]
        expect(submitScript.indexOf('const auth = await window.cdnAuth')).toBeLessThan(
            submitScript.indexOf('status.textContent = \'Preparing upload…\''),
        )
        expect(upload).toContain('/assets/exifreader.js')
        expect(upload).toContain('/assets/upload-picker.js')
        expect(upload).toContain('const files = picker.files')
        expect(upload).toContain('fetch(\'/api/files/bulk\'')
        expect(upload).toContain('X-CDN-Upload-Count')
        expect(upload).toContain('if (response.status === 401) return login()')
        expect(upload).toContain('if (!auth) {')
        expect(upload).toContain('await wait(1000)')
        expect(upload).toContain('const batch = files.slice(start, end)')
        expect(upload).toContain('for (const file of batch) data.append(\'files\', file, file.name)')
        expect(upload).toContain('const fileUrl = id => \'/api/files/\' + encodeURIComponent(id)')
        expect(upload).not.toContain('link.href = \'/files/\'')
        expect(gallery).toContain('id="photo-library"')
        expect(gallery).toContain('id="photo-search"')
        expect(gallery).toContain('id="date-timeline"')
        expect(gallery).toContain('repeat(var(--photo-columns, 5), minmax(0, 1fr))')
        expect(gallery).toContain('id="grid-density"')
        expect(gallery).toContain('<option value="1">1 per row</option>')
        expect(gallery).toContain('<option value="3">3 per row</option>')
        expect(gallery).toContain('<option value="5" selected>5 per row</option>')
        expect(gallery).toContain('aria-label="Gallery" title="Gallery"')
        expect(gallery).toContain('aria-label="Upload" title="Upload"')
        expect(gallery).toContain('.photo-card.is-selected')
        expect(gallery).toContain('/assets/gallery.js')
        expect(galleryClient).toContain('const fileUrl = (id, thumbnail = false) => \'/api/files/\'')
        expect(galleryClient).toContain('?variant=thumbnail')
        expect(galleryClient).toContain('/timeline')
        expect(galleryClient).toContain('photo-favorite')
        expect(galleryClient).toContain('button.dataset.view')
        expect(galleryClient).toContain('searchLibrary')
        expect(gallery).toContain('class="loading-indicator"')
        expect(gallery).not.toContain('Loading…')
        expect(gallery).not.toContain('Your uploaded files and share links.')
        expect(gallery).not.toContain('aria-label="Hanasand CDN"')
        expect(gallery).toContain('class="photo-viewer"')
        expect(() => new Function(galleryClient)).not.toThrow()
        expect(login).toContain('main.login-page { width: min(100%, 28rem); max-width: 28rem;')
        expect(login).not.toContain('Sign in to your Hanasand account to upload files and view your library.')
        expect(login).toContain('<link rel="stylesheet" href="/assets/login-form.css">')
        expect(login).toContain('<script type="module" src="/assets/login-form.js"></script>')
        expect(login).not.toContain('/api/auth/device-proof-client.js')
        expect(login).not.toContain('/api/auth/login-form.js')
        expect(login).not.toContain('identity.hanasand.com/api/auth/login-form.js')
        expect(login).not.toContain('api.hanasand.com/api/auth/login-form.js')
        expect(login).toContain('<form id="cdn-login-form" action="/api/auth/login" method="post">')
        expect(login).toContain('<hanasand-login-form')
        expect(login).not.toContain('login-url=')
        expect(login).toContain('passkey-options-url="/api/auth/passkeys/authenticate/options"')
        expect(login).toContain('passkey-verify-url="/api/auth/passkeys/authenticate/verify"')
        expect(login).toContain('sso-href="/api/auth/sso/start?redirectPath=%2Fgallery"')
        expect(login).toContain('redirect-path="/gallery"')
        expect(login).toContain('input:focus, input:focus-visible {')
        expect(login).toContain('background-color: #080808; color: #f6f6f3; border-color: #707070;')
        expect(login).toContain('input::selection { background: #303030; color: #f6f6f3; }')
        expect(login).toContain('input:-webkit-autofill')
        expect(login).toContain('button:focus-visible, a:focus-visible, input:focus-visible')
        expect(login).toContain('outline: 2px solid #999;')
        expect(login).toContain('input:focus-visible { outline-color: #707070; outline-offset: 2px; }')
        expect(galleryClient).toContain('preview.src = fileUrl(file.id, !isVideo)')
        expect(galleryClient).toContain('viewer.showModal()')
        expect(galleryClient).toContain('viewerImage.src = url')
        expect(galleryClient).toContain('const movePhoto = step =>')
        expect(galleryClient).toContain('?limit=100&offset=')
        expect(gallery).toContain('Load more')
        expect(galleryClient).toContain('location.replace(\'/login?returnTo=\'')
        expect(upload).not.toContain('https://hanasand.com/upload')
        expect(gallery).not.toContain('https://hanasand.com/gallery')
        expect(login).not.toContain('hanasand.com/login')
        expect(uploadHeaders['Cache-Control']).toBe('private, no-store')
        expect(galleryHeaders['Cache-Control']).toBe('private, no-store')
        expect(loginHeaders['Cache-Control']).toBe('private, no-store')
    })

    test('keeps login return paths on CDN and escapes markup', async () => {
        const { html } = await page(getLoginPage, { query: { returnTo: '/gallery?sort=date&view=images' } })
        expect(html).toContain('redirect-path="/gallery?sort=date&amp;view=images"')
        expect(html).toContain('sso-href="/api/auth/sso/start?redirectPath=%2Fgallery%3Fsort%3Ddate%26view%3Dimages"')

        const { html: unsafe } = await page(getLoginPage, { query: { returnTo: '//attacker.example/path' } })
        expect(unsafe).toContain('redirect-path="/gallery"')
        expect(unsafe).toContain('sso-href="/api/auth/sso/start?redirectPath=%2Fgallery"')
    })

    test('serves the shared picker and image metadata assets', async () => {
        const picker = await script(getUploadPickerScript)
        const exifReader = await script(getExifReaderScript)

        expect(() => new Function(picker)).not.toThrow()
        expect(() => new Function(exifReader)).not.toThrow()
        expect(picker).toContain('this.selectedFiles.concat(incoming)')
        expect(picker).not.toContain('No files selected')
        expect(picker).toContain('.drop-side { display: grid; min-height: 11rem;')
        expect(picker).toContain('or choose files to upload')
        expect(picker).not.toContain('or choose files from the other panel')
        expect(picker).toContain('.panel { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); }')
        expect(picker).toContain('gpslatitude')
        expect(picker).toContain('datetimeoriginal')
        expect(picker).toContain('tags.pngText')
        expect(picker).toContain('if (location) meta.append(this.metadataItem(\'location\', \'Location\', location))')
        expect(picker).toContain('document.createElementNS(\'http://www.w3.org/2000/svg\', \'svg\')')
        expect(picker).not.toContain('Date and location come from embedded metadata')
        expect(picker).not.toContain('unavailable')
        expect(picker).not.toContain('accept="image/*"')
        expect(exifReader.length).toBeGreaterThan(100_000)
    })
})
