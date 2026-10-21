import { describe, expect, test } from 'bun:test'
import { getGalleryPage, getLoginPage, getUploadPage } from '../src/handlers/index/staticPages.ts'
import redirectLegacyFile from '../src/handlers/files/redirectLegacy.ts'
import { fileResponseHeaders } from '../src/utils/fileResponse.ts'

async function page(handler: typeof getUploadPage) {
    let html = ''
    const headers: Record<string, string> = {}
    const reply = {
        header: (name: string, value: string) => { headers[name] = value; return reply },
        type: () => reply,
        send: (body: string) => { html = body; return body },
    }
    await handler({} as never, reply as never)
    return { html, headers }
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

describe('standalone CDN pages', () => {
    test('upload supports guests while the gallery requires a session', async () => {
        const uploadPage = await page(getUploadPage)
        const galleryPage = await page(getGalleryPage)
        const loginPage = await page(getLoginPage)
        const { html: upload, headers: uploadHeaders } = uploadPage
        const { html: gallery, headers: galleryHeaders } = galleryPage
        const { html: login, headers: loginHeaders } = loginPage

        expect(upload).toContain('fetch(\'/api/files\'')
        expect(upload).toContain('type="file" multiple aria-label="Browse files"')
        expect(upload).toContain('grid-template-columns: minmax(0,1.05fr) minmax(20rem,.95fr)')
        expect(upload).toContain('Drop files here')
        expect(upload).toContain('dropzone.addEventListener(\'drop\'')
        expect(upload).toContain('fileInput.files = transfer.files')
        expect(upload).toContain('Browse files')
        expect(upload).toContain('fetch(\'/api/files/bulk\'')
        expect(upload).toContain('X-CDN-Upload-Count')
        expect(upload).toContain('if (response.status === 401) return null')
        expect(upload).toContain('if (!auth) {')
        expect(upload).toContain('await wait(1000)')
        expect(gallery).toContain('\'/api/files/user/\' + encodeURIComponent(auth.id)')
        expect(upload).toContain('const fileUrl = id => \'/api/files/\' + encodeURIComponent(id)')
        expect(gallery).toContain('const fileUrl = id => \'/api/files/\' + encodeURIComponent(id)')
        expect(upload).not.toContain('link.href = \'/files/\'')
        expect(gallery).not.toContain('link.href = \'/files/\'')
        expect(gallery).toContain('.gallery { display: grid;')
        expect(gallery).toContain('preview.src = url')
        expect(gallery).toContain('summary.append(preview)')
        expect(gallery).toContain('details.append(summary, info)')
        expect(gallery).toContain('info.append(name, meta, link)')
        expect(gallery).toContain('?limit=100&offset=')
        expect(gallery).toContain('Load more')
        expect(gallery).not.toContain('link.textContent = file.name')
        expect(gallery).toContain('location.replace(\'/login?returnTo=\'')
        expect(upload).not.toContain('https://hanasand.com/upload')
        expect(gallery).not.toContain('https://hanasand.com/gallery')
        expect(login).toContain('fetch(\'/api/auth/login\'')
        expect(login).not.toContain('hanasand.com/login')
        expect(uploadHeaders['Cache-Control']).toBe('private, no-store')
        expect(galleryHeaders['Cache-Control']).toBe('private, no-store')
        expect(loginHeaders['Cache-Control']).toBe('private, no-store')
    })
})
