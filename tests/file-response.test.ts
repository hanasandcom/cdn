import { describe, expect, test } from 'bun:test'
import { getGalleryPage, getLoginPage, getUploadPage } from '../src/handlers/index/staticPages.ts'
import { fileResponseHeaders } from '../src/utils/fileResponse.ts'

async function page(handler: typeof getUploadPage) {
    let html = ''
    const reply = {
        type: () => reply,
        send: (body: string) => { html = body; return body },
    }
    await handler({} as never, reply as never)
    return html
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

describe('standalone CDN pages', () => {
    test('upload and gallery call the local service and require a session', async () => {
        const upload = await page(getUploadPage)
        const gallery = await page(getGalleryPage)
        const login = await page(getLoginPage)

        expect(upload).toContain('fetch(\'/api/files\'')
        expect(gallery).toContain('fetch(\'/api/files/user/\'')
        expect(upload).toContain('location.replace(\'/login?returnTo=\'')
        expect(upload).not.toContain('https://hanasand.com/upload')
        expect(gallery).not.toContain('https://hanasand.com/gallery')
        expect(login).toContain('fetch(\'/api/auth/login\'')
        expect(login).not.toContain('hanasand.com/login')
    })
})
