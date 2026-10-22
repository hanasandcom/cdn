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
        expect(login).toContain('main.login-page { width: min(100%, 18rem);')
        expect(login).toContain('.login-field { display: grid; gap: 1.25rem; }')
        expect(login).toContain('.login-form label { margin: 0; }')
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
        expect(login).toContain('fetch(\'/api/auth/login\'')
        expect(login).not.toContain('hanasand.com/login')
        expect(uploadHeaders['Cache-Control']).toBe('private, no-store')
        expect(galleryHeaders['Cache-Control']).toBe('private, no-store')
        expect(loginHeaders['Cache-Control']).toBe('private, no-store')
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
