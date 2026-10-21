import type { FastifyReply, FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'

const uploadPickerPath = new URL('../../client/upload-picker.js', import.meta.url)
const exifReaderPath = new URL('../../../node_modules/exifreader/dist/exif-reader.js', import.meta.url)

export async function getUploadPickerScript(_req: FastifyRequest, res: FastifyReply) {
    const script = await readFile(uploadPickerPath)
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(script)
}

export async function getExifReaderScript(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(await readFile(exifReaderPath))
}

const styles = `
:root { color-scheme: dark; font: 16px system-ui, sans-serif; background: #050505; color: #f6f6f3; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; padding: 2rem 1rem; display: grid; place-items: center; }
main { width: min(100%, 58rem); padding: 2rem; border: 1px solid #393939; border-radius: 1rem; background: #101010; }
a { color: inherit; }
header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
h1 { font-size: 2rem; margin: .5rem 0; }
p { color: #aaa; line-height: 1.5; }
input, button { font: inherit; border-radius: .6rem; padding: .75rem; }
input { width: 100%; background: #080808; color: #fff; border: 1px solid #393939; }
button { border: 0; background: #f6f6f3; color: #111; font-weight: 600; cursor: pointer; }
button:disabled { cursor: wait; opacity: .65; }
button:focus-visible, a:focus-visible, input:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
}
.intro { max-width: 42rem; margin: .5rem 0 1.5rem; }
.upload-panel { display: grid; gap: .75rem; }
.upload-actions { display: flex; justify-content: flex-end; }
.upload-submit { min-height: 2.5rem; border: 1px solid #393939; background: #202020; color: #f6f6f3; }
.upload-submit:hover { border-color: #777; }
.upload-status { overflow-wrap: anywhere; }
.upload-status img { margin-top: .75rem; border-radius: .5rem; }
.upload-hint { margin: 1.5rem 0 0; font-size: .75rem; }
.upload-panel.checking-auth .upload-submit { cursor: default; opacity: 1; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr)); gap: .75rem; margin-top: 1rem; }
.file { min-width: 0; overflow: hidden; border: 1px solid #393939; border-radius: .75rem; background: #080808; }
.file summary { display: block; cursor: pointer; list-style: none; }
.file summary::-webkit-details-marker { display: none; }
.file summary:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.preview { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #161616; }
.file-placeholder { display: grid; width: 100%; aspect-ratio: 4 / 3; place-items: center;
    background: #161616; color: #aaa; font-size: 2rem; }
.file-info { padding: .75rem; overflow-wrap: anywhere; }
.file-info p { margin: .25rem 0; }
.muted { color: #aaa; }
`

function shell(title: string, body: string) {
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${title} · Hanasand CDN</title>
<style>${styles}</style>
<main>
<header><a href="/" aria-label="Hanasand CDN">Hanasand CDN</a>
<nav><a href="/gallery">Gallery</a> · <a href="/upload">Upload</a></nav></header>
<h1>${title}</h1>
${body}
</main>
</html>`
}

const authScript = `<script>
const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
const fileUrl = id => '/api/files/' + encodeURIComponent(id)
window.cdnAuth = (async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    if (response.status === 401) { login(); return null }
    if (!response.ok) throw Error('Your session could not be checked. Reload to try again.')
    return response.json()
})()
</script>`

const uploadAuthScript = `<script>
const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
const fileUrl = id => '/api/files/' + encodeURIComponent(id)
window.cdnAuth = (async () => {
    const response = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    if (response.status === 401) return null
    if (!response.ok) throw Error('Your session could not be checked. Reload to try again.')
    return response.json()
})()
</script>`

export async function getUploadPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<p class="intro">Upload images, videos or files.</p>
<form id="upload" class="upload-panel checking-auth">
<hanasand-upload-picker id="picker" disabled
    description="Choose files to upload, or drag them into the drop area."></hanasand-upload-picker>
<div class="upload-actions">
<button class="upload-submit" type="submit">Upload</button>
</div>
</form>
<p id="status" class="upload-status" role="status" aria-live="polite"></p>
<p id="upload-hint" class="upload-hint" hidden>Sign in to upload multiple files at once.</p>
<script defer src="/assets/exifreader.js"></script>
<script defer src="/assets/upload-picker.js"></script>
${uploadAuthScript}
<script>
const form = document.querySelector('#upload')
const picker = document.querySelector('#picker')
const status = document.querySelector('#status')
const hint = document.querySelector('#upload-hint')
const button = form.querySelector('.upload-submit')
button.disabled = true
Promise.all([customElements.whenDefined('hanasand-upload-picker'), window.cdnAuth]).then(([, auth]) => {
    if (auth) picker.setAttribute('multiple', '')
    else hint.hidden = false
    form.classList.remove('checking-auth')
    picker.removeAttribute('disabled')
    button.disabled = false
}).catch(() => {
    form.classList.remove('checking-auth')
    status.textContent = 'Sign-in could not be checked. Reload to try again.'
})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const addLink = (parent, url, text) => {
    const link = document.createElement('a')
    link.href = url
    link.textContent = text
    parent.append(link)
}
form.addEventListener('submit', async event => {
    event.preventDefault()
    const files = picker.files
    if (!files.length) return
    button.disabled = true
    status.textContent = 'Preparing upload…'
    try {
        const auth = await window.cdnAuth
        if (!auth) {
            const links = []
            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                status.textContent = 'Uploading ' + (i + 1) + ' of ' + files.length + ' files…'
                const data = new FormData()
                data.set('file', file)
                data.set('name', file.name)
                data.set('type', file.type || 'application/octet-stream')
                while (true) {
                    const response = await fetch('/api/files', { method: 'POST', body: data, credentials: 'same-origin' })
                    if (response.status === 429) {
                        const delay = Math.max(1, Number(response.headers.get('Retry-After')) || 1)
                        await wait(delay * 1000)
                        continue
                    }
                    const result = await response.json()
                    if (!response.ok) throw Error(result.error || 'Upload failed.')
                    const url = fileUrl(result.id)
                    links.push({ url, name: file.name, type: file.type })
                    break
                }
                if (i < files.length - 1) await wait(1000)
            }
            status.replaceChildren()
            for (const item of links) {
                const row = document.createElement('p')
                addLink(row, item.url, item.name + ' · ' + location.origin + item.url)
                if (/^image[/](jpeg|png|gif|webp|avif)$/i.test(item.type)) {
                    const preview = document.createElement('img')
                    preview.className = 'preview'
                    preview.src = item.url
                    preview.alt = item.name
                    row.append(preview)
                }
                status.append(row)
            }
            return
        }
        if (files.length === 1) {
            const file = files[0]
            const data = new FormData()
            data.set('file', file)
            data.set('name', file.name)
            data.set('type', file.type || 'application/octet-stream')
            const response = await fetch('/api/files', { method: 'POST', body: data, credentials: 'same-origin' })
            if (response.status === 401) return login()
            const result = await response.json()
            if (!response.ok) throw Error(result.error || 'Upload failed.')
            status.textContent = 'Uploaded: '
            const url = fileUrl(result.id)
            addLink(status, url, location.origin + url)
            if (/^image[/](jpeg|png|gif|webp|avif)$/i.test(file.type)) {
                const preview = document.createElement('img')
                preview.className = 'preview'
                preview.src = url
                preview.alt = file.name
                status.append(preview)
            }
            return
        }

        const uploaded = []
        const failed = []
        let start = 0
        while (start < files.length) {
            let end = start
            let batchBytes = 0
            while (end < files.length && end - start < 5000 && batchBytes + files[end].size <= 45 * 1024 * 1024) {
                batchBytes += files[end].size
                end++
            }
            if (end === start) {
                const file = files[start]
                status.textContent = 'Uploading ' + (start + 1) + ' of ' + files.length + ' files…'
                const data = new FormData()
                data.set('file', file)
                data.set('name', file.name)
                data.set('type', file.type || 'application/octet-stream')
                while (true) {
                    const response = await fetch('/api/files', { method: 'POST', body: data, credentials: 'same-origin' })
                    if (response.status === 401) return login()
                    if (response.status === 429) {
                        const delay = Math.max(1, Number(response.headers.get('Retry-After')) || 1)
                        await wait(delay * 1000)
                        continue
                    }
                    const result = await response.json()
                    if (!response.ok) throw Error(result.error || 'Upload failed.')
                    uploaded.push({ id: result.id, name: file.name })
                    break
                }
                start++
                continue
            }
            const batch = files.slice(start, end)
            let result
            while (true) {
                status.textContent = 'Uploading ' + (start + 1) + ' of ' + files.length + ' files…'
                const data = new FormData()
                for (const file of batch) data.append('files', file, file.name)
                const response = await fetch('/api/files/bulk', {
                    method: 'POST',
                    headers: { 'X-CDN-Upload-Count': String(batch.length) },
                    body: data,
                    credentials: 'same-origin',
                })
                if (response.status === 401) return login()
                if (response.status === 429) {
                    const delay = Math.max(1, Number(response.headers.get('Retry-After')) || 1)
                    await wait(delay * 1000)
                    continue
                }
                result = await response.json()
                if (!response.ok) throw Error(result.error || 'Bulk upload failed.')
                break
            }
            uploaded.push(...result.uploaded)
            failed.push(...result.failed)
            start = end
            status.textContent = 'Uploaded ' + uploaded.length + ' of ' + files.length + ' files…'
        }
        status.replaceChildren()
        const summary = document.createElement('p')
        summary.textContent = uploaded.length + ' uploaded, ' + failed.length + ' failed.'
        const gallery = document.createElement('a')
        gallery.href = '/gallery'
        gallery.textContent = 'Open gallery'
        status.append(summary, gallery)
        if (failed.length) {
            const list = document.createElement('ul')
            for (const item of failed.slice(0, 20)) {
                const row = document.createElement('li')
                row.textContent = item.name + ': ' + item.error
                list.append(row)
            }
            status.append(list)
            if (failed.length > 20) {
                const more = document.createElement('p')
                more.textContent = 'Showing 20 of ' + failed.length + ' errors.'
                status.append(more)
            }
        }
    } catch (error) {
        status.textContent = error.message || 'Upload failed.'
    } finally {
        button.disabled = false
    }
})
</script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Upload media', body))
}

export async function getLoginPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<p>Sign in to your Hanasand account to upload files and view your library.</p>
<form id="login" class="login-form">
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<div class="actions"><button id="submit">Sign in</button></div>
</form>
<p id="status" role="status" aria-live="polite"></p>
<script>
const form = document.querySelector('#login')
const status = document.querySelector('#status')
form.addEventListener('submit', async event => {
    event.preventDefault()
    const button = document.querySelector('#submit')
    button.disabled = true
    status.textContent = 'Signing in…'
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: form.elements.username.value,
                password: form.elements.password.value,
            }),
        })
        const result = await response.json()
        if (!response.ok) throw Error(result.error || 'Sign-in failed.')
        const target = new URLSearchParams(location.search).get('returnTo') || '/gallery'
        location.replace(target.startsWith('/') && !target.startsWith('//') ? target : '/gallery')
    } catch (error) {
        status.textContent = error.message || 'Sign-in failed. Please try again.'
        button.disabled = false
    }
})
</script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Sign in', body))
}

export async function getGalleryPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<p>Your uploaded files and share links.</p>
<section id="files" aria-live="polite" class="gallery">Loading…</section>
<button id="load-more" type="button" hidden>Load more</button>
${authScript}
<script>
const root = document.querySelector('#files')
const loadMore = document.querySelector('#load-more')
let offset = 0
let previewCount = 0
const appendFiles = files => {
    for (const file of files) {
        const details = document.createElement('details')
        const summary = document.createElement('summary')
        const info = document.createElement('div')
        const name = document.createElement('p')
        const meta = document.createElement('p')
        const link = document.createElement('a')
        details.className = 'file'
        const url = fileUrl(file.id)
        const isImage = /^image[/](jpeg|png|gif|webp|avif)$/i.test(file.type)
        if (isImage) {
            const preview = document.createElement('img')
            preview.className = 'preview'
            preview.src = url
            preview.alt = file.name
            preview.decoding = 'async'
            preview.loading = previewCount === 0 ? 'eager' : 'lazy'
            previewCount++
            summary.append(preview)
        } else {
            const placeholder = document.createElement('span')
            placeholder.className = 'file-placeholder'
            placeholder.setAttribute('aria-hidden', 'true')
            placeholder.textContent = '▤'
            summary.append(placeholder)
        }
        name.textContent = file.name
        meta.className = 'muted'
        meta.textContent = file.type + ' · ' + new Date(file.uploaded_at).toLocaleString()
        link.href = url
        link.textContent = 'Open original'
        link.setAttribute('aria-label', 'Open ' + file.name)
        info.className = 'file-info'
        info.append(name, meta, link)
        details.append(summary, info)
        root.append(details)
    }
    offset += files.length
    loadMore.hidden = files.length < 100
}
const fetchFiles = async auth => {
    loadMore.disabled = true
    try {
        const response = await fetch(
            '/api/files/user/' + encodeURIComponent(auth.id) + '?limit=100&offset=' + offset,
            { cache: 'no-store', credentials: 'same-origin' },
        )
        if (response.status === 401) return login()
        if (!response.ok) throw Error('Your library could not be loaded.')
        const files = await response.json()
        if (!offset && !files.length) root.textContent = 'No files yet.'
        else appendFiles(files)
    } finally {
        loadMore.disabled = false
    }
}
loadMore.addEventListener('click', () => window.cdnAuth
    .then(auth => auth && fetchFiles(auth))
    .catch(error => { loadMore.textContent = error.message || 'Could not load more files.' }))
window.cdnAuth.then(auth => auth && fetchFiles(auth))
    .catch(error => { root.textContent = error.message || 'Your library could not be loaded.' })
</script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Your files', body))
}
