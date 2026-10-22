import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const client = await readFile(new URL('../src/client/gallery.js', import.meta.url), 'utf8')
const pages = await readFile(new URL('../src/handlers/index/staticPages.ts', import.meta.url), 'utf8')

test('gallery retries an unauthorized request after checking the shared session', () => {
    expect(client).toContain('fetch(\'/api/auth/session\'')
    expect(client).toContain('for (const delay of [0, 250, 750])')
    expect(client).toContain('if (session === \'valid\') response = await request()')
    expect(client).toContain('else if (session === \'expired\')')
    expect(client).toContain('Could not verify your sign-in. Please try again.')
})

test('selected photos have a visible check and selection count', () => {
    expect(pages).toContain('.photo-select:checked + .photo-select-indicator::after')
    expect(pages).toContain('.selection-count')
    expect(pages).toContain('id="selection-count" class="selection-count"')
    expect(client).toContain('selectionIndicator.className = \'photo-select-indicator\'')
    expect(client).toContain('selectionCount.textContent = count ? `${count} selected` : \'\'')
})
