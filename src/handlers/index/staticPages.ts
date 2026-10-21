import type { FastifyReply, FastifyRequest } from 'fastify'

const styles = `
:root { color-scheme: dark; font: 16px system-ui, sans-serif; background: #050505; color: #f6f6f3; }
* { box-sizing: border-box; }
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
button:focus-visible, a:focus-visible, input:focus-visible, .dropzone:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 3px;
}
.intro { max-width: 42rem; margin: .5rem 0 1.5rem; }
.upload-panel {
    display: grid;
    overflow: hidden;
    border: 1px solid #393939;
    border-radius: .75rem;
    background: #101010;
    box-shadow: 0 8px 24px #0005;
}
.drop-side {
    display: none;
    min-height: 26rem;
    place-items: center;
    border-right: 1px solid #393939;
    background: #161616;
    padding: 1.5rem;
}
.dropzone {
    display: grid;
    width: 100%;
    height: 100%;
    min-height: 22rem;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    border: 1px dashed #555;
    border-radius: .6rem;
    background: #101010;
    text-align: center;
    transition: background .15s, border-color .15s;
}
.dropzone.dragging { border-color: #f6f6f3; background: #252525; }
.drop-icon {
    display: grid;
    width: 3rem;
    height: 3rem;
    place-items: center;
    border: 1px solid #393939;
    border-radius: .6rem;
    color: #f6f6f3;
    font-size: 1.5rem;
}
.upload-side { display: grid; align-content: start; gap: 1.25rem; padding: 1.5rem; }
.upload-side > p { margin: 0; }
.browse-button {
    position: relative;
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: .6rem;
    background: #f6f6f3;
    color: #111;
    font-weight: 600;
    cursor: pointer;
}
.browse-button:hover { opacity: .9; }
.browse-button:focus-within { outline: 2px solid #fff; outline-offset: 3px; }
#file {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    opacity: 0;
    cursor: pointer;
}
.selected-files { min-height: 1.5rem; overflow-wrap: anywhere; color: #aaa; font-size: .875rem; }
.upload-submit { min-height: 2.5rem; border: 1px solid #393939; background: #202020; color: #f6f6f3; }
.upload-submit:hover { border-color: #777; }
.upload-status { overflow-wrap: anywhere; }
.upload-status img { margin-top: .75rem; border-radius: .5rem; }
@media (min-width: 48rem) {
    .upload-panel { grid-template-columns: minmax(0,1.05fr) minmax(20rem,.95fr); }
    .drop-side { display: grid; }
}
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
<form id="upload" class="upload-panel">
<div class="drop-side" id="dropSide">
<div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Drop files here or browse files">
<span class="drop-icon" aria-hidden="true">↑</span><strong>Drop files here</strong>
<span class="muted">or choose files from the other panel</span>
</div>
</div>
<div class="upload-side">
<p>Choose files to upload, or drag them into the drop area.</p>
<label class="browse-button">Browse files
<input id="file" name="file" type="file" multiple aria-label="Browse files">
</label>
<div id="selectedFiles" class="selected-files" aria-live="polite">No files selected</div>
<button class="upload-submit" type="submit">Upload</button>
</div>
</form>
<p id="status" class="upload-status" role="status" aria-live="polite"></p>
${uploadAuthScript}
<script>
const form = document.querySelector('#upload')
const fileInput = document.querySelector('#file')
const status = document.querySelector('#status')
const button = form.querySelector('.upload-submit')
const dropzone = document.querySelector('#dropzone')
const selectedFiles = document.querySelector('#selectedFiles')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const showFiles = files => {
    if (!files.length) {
        selectedFiles.textContent = 'No files selected'
        return
    }
    selectedFiles.textContent = files.length + ' file' + (files.length === 1 ? '' : 's') +
        ' selected: ' + Array.from(files, file => file.name).join(', ')
}
fileInput.addEventListener('change', () => showFiles(fileInput.files))
dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        fileInput.click()
    }
})
dropzone.addEventListener('dragover', event => {
    event.preventDefault()
    dropzone.classList.add('dragging')
})
dropzone.addEventListener('dragleave', event => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove('dragging')
})
dropzone.addEventListener('drop', event => {
    event.preventDefault()
    dropzone.classList.remove('dragging')
    if (!event.dataTransfer.files.length) return
    const transfer = new DataTransfer()
    for (const file of event.dataTransfer.files) transfer.items.add(file)
    fileInput.files = transfer.files
    showFiles(fileInput.files)
})
const addLink = (parent, url, text) => {
    const link = document.createElement('a')
    link.href = url
    link.textContent = text
    parent.append(link)
}
form.addEventListener('submit', async event => {
    event.preventDefault()
    const files = Array.from(fileInput.files)
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
