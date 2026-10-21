import type { FastifyReply, FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'
import { getSessionDetails, setSessionCookies } from '#utils/auth/session.ts'

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
main.login-page { width: min(100%, 24rem); max-width: 24rem; padding: 1.25rem; }
main.gallery-page { width: min(100%, 96rem); }
a { color: inherit; }
header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
main.login-page header { flex-wrap: wrap; }
h1 { font-size: 2rem; margin: .5rem 0; }
p { color: #aaa; line-height: 1.5; }
input, button { font: inherit; border-radius: .6rem; padding: .75rem; }
input {
    appearance: none; width: 100%; background: #080808; color: #f6f6f3;
    border: 1px solid #393939; caret-color: #f6f6f3;
}
input:focus {
    background: #121212; color: #f6f6f3; border-color: #777;
}
input::selection { background: #454545; color: #fff; }
input:-webkit-autofill {
    -webkit-text-fill-color: #f6f6f3; caret-color: #f6f6f3;
    -webkit-box-shadow: 0 0 0 1000px #121212 inset; box-shadow: 0 0 0 1000px #121212 inset;
}
input:autofill {
    -webkit-text-fill-color: #f6f6f3; caret-color: #f6f6f3;
    -webkit-box-shadow: 0 0 0 1000px #121212 inset; box-shadow: 0 0 0 1000px #121212 inset;
}
button { border: 0; background: #f6f6f3; color: #111; font-weight: 600; cursor: pointer; }
button:disabled { cursor: wait; opacity: .65; }
button:focus-visible, a:focus-visible, input:focus-visible {
    outline: 2px solid #999;
    outline-offset: 3px;
}
.login-form { display: grid; gap: 1rem; }
.login-field { display: grid; gap: .5rem; }
.login-form label { margin: 0; }
.login-form input { min-height: 2.75rem; }
.login-form .actions { margin-top: .35rem; }
.intro { max-width: 42rem; margin: .5rem 0 1.5rem; }
.upload-panel { display: grid; gap: .75rem; }
.upload-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
.upload-submit { min-height: 2.5rem; border: 1px solid #393939; background: #202020; color: #f6f6f3; }
.upload-submit:hover { border-color: #777; }
.upload-status { overflow-wrap: anywhere; }
.upload-status img { margin-top: .75rem; border-radius: .5rem; }
.upload-hint { margin: 0; font-size: .75rem; }
hanasand-upload-picker { display: block; }
.picker-fallback {
    display: grid; overflow: hidden; grid-template-columns: minmax(0, 1fr);
    border: 1px solid #393939; border-radius: .75rem; background: #101010;
    box-shadow: 0 8px 24px #0005;
}
.picker-fallback-drop-side {
    display: grid; min-height: 11rem; place-items: center;
    border-bottom: 1px solid #393939; background: #191919; padding: .75rem;
}
.picker-fallback-dropzone {
    display: grid; width: 100%; min-height: 9rem; place-content: center;
    justify-items: center; gap: 1rem; border: 1px dashed #393939;
    border-radius: .75rem; background: #101010; padding: 1.25rem; text-align: center;
}
.picker-fallback-icon {
    display: grid; width: 3rem; height: 3rem; place-items: center;
    border: 1px solid #393939; border-radius: .65rem; color: #f6f6f3; font-size: 1.5rem;
}
.picker-fallback-title { color: #f6f6f3; font-size: .875rem; font-weight: 650; }
.picker-fallback-muted { color: #aaa; font-size: .8rem; }
.picker-fallback-side { display: grid; min-width: 0; align-content: start; gap: 1rem; padding: 1.25rem; }
.picker-fallback-description { margin: 0; color: #aaa; font-size: .875rem; line-height: 1.5; }
.picker-fallback-browse {
    display: flex; min-height: 2.75rem; align-items: center; justify-content: center;
    border: 1px solid transparent; border-radius: .6rem; background: #f6f6f3;
    color: #111; padding: .7rem .85rem; font-size: .875rem; font-weight: 650; text-align: center;
}
hanasand-upload-picker:defined > .picker-fallback { display: none; }
.gallery {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
    gap: .75rem; margin-top: 1rem; justify-content: start; justify-items: stretch; align-content: start;
}
.gallery[aria-busy="true"] { min-height: 12rem; place-items: center; }
.loading-indicator {
    width: 2rem; height: 2rem; border: 2px solid #555; border-top-color: #f6f6f3;
    border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
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
.photo-viewer {
    width: min(96vw, 90rem); max-width: none; height: min(92dvh, 60rem); max-height: none;
    padding: 0; border: 1px solid #393939; border-radius: 1rem; background: #101010; color: #f6f6f3;
}
.photo-viewer::backdrop { background: #000d; backdrop-filter: blur(8px); }
.viewer-layout { display: grid; width: 100%; height: 100%; grid-template-columns: minmax(0, 1fr) 18rem; }
.viewer-stage { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; background: #050505; }
.viewer-toolbar {
    display: flex; min-height: 3.5rem; align-items: center; justify-content: space-between;
    gap: .75rem; padding: .5rem .75rem;
}
.viewer-toolbar button, .viewer-nav button {
    min-width: 2.5rem; min-height: 2.5rem; border: 1px solid #393939;
    background: #202020; color: #f6f6f3;
}
.viewer-image-wrap { display: grid; min-height: 0; place-items: center; overflow: hidden; padding: 1rem; }
.viewer-image { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.viewer-nav { display: flex; justify-content: space-between; padding: .5rem .75rem; }
.viewer-info { overflow: auto; padding: 1.25rem; border-left: 1px solid #393939; }
.viewer-info h2 { margin: .25rem 0 1rem; overflow-wrap: anywhere; font-size: 1rem; }
.viewer-info p { overflow-wrap: anywhere; }
.viewer-download { display: inline-flex; margin-top: 1rem; }
@media (max-width: 48rem) {
    main.login-page { padding: 1rem; }
    main.login-page header { align-items: flex-start; flex-direction: column; gap: .5rem; }
    main.login-page header nav { align-self: flex-end; }
    main.gallery-page { padding: 1rem; }
    .photo-viewer { width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
    .viewer-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    .viewer-info { max-height: 30dvh; border-top: 1px solid #393939; border-left: 0; padding: .75rem 1rem; }
    .viewer-info h2 { margin-bottom: .5rem; }
}
@media (min-width: 48rem) {
    .picker-fallback { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); }
    .picker-fallback-drop-side { min-height: 26.25rem; border-right: 1px solid #393939; border-bottom: 0; padding: 1.5rem; }
    .picker-fallback-dropzone { min-height: 21rem; padding: 2rem; }
    .picker-fallback-side { gap: 1.25rem; padding: 1.5rem; }
}
`

function shell(title: string, body: string, options: { mainClass?: string, showBrand?: boolean } = {}) {
    const brand = options.showBrand === false ? '' : '<a href="/" aria-label="Hanasand CDN">Hanasand CDN</a>'
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${title} · Hanasand CDN</title>
<style>${styles}</style>
<main class="${options.mainClass || ''}">
<header>${brand}
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

function uploadAuthScript(userId: string | null) {
    const auth = userId ? JSON.stringify({ id: userId }) : 'null'
    return `<script>
const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
const fileUrl = id => '/api/files/' + encodeURIComponent(id)
window.cdnAuth = Promise.resolve(${auth})
</script>`
}

export async function getUploadPage(req: FastifyRequest, res: FastifyReply) {
    const session = await getSessionDetails(req)
    const userId = session?.id || null
    if (session) setSessionCookies(req, res, session)
    const guestHint = userId ? '' : '<p id="upload-hint" class="upload-hint">Sign in to upload multiple files at once.</p>'
    const body = `<p class="intro">Upload images, videos or files.</p>
<form id="upload" class="upload-panel">
<hanasand-upload-picker id="picker" multiple
    description="Choose files to upload, or drag them into the drop area.">
<div class="picker-fallback" aria-hidden="true">
<div class="picker-fallback-drop-side">
<div class="picker-fallback-dropzone"><span class="picker-fallback-icon">↑</span>
<span class="picker-fallback-title">Drop files here</span>
<span class="picker-fallback-muted">or choose files to upload</span></div>
</div>
<div class="picker-fallback-side">
<p class="picker-fallback-description">Choose files to upload, or drag them into the drop area.</p>
<span class="picker-fallback-browse">Browse files</span></div>
</div>
</hanasand-upload-picker>
<div class="upload-actions">
${guestHint}
<button class="upload-submit" type="submit">Upload</button>
</div>
</form>
<p id="status" class="upload-status" role="status" aria-live="polite"></p>
<script defer src="/assets/exifreader.js"></script>
<script defer src="/assets/upload-picker.js"></script>
${uploadAuthScript(userId)}
<script>
const form = document.querySelector('#upload')
const picker = document.querySelector('#picker')
const status = document.querySelector('#status')
const button = form.querySelector('.upload-submit')
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
    try {
        const auth = await window.cdnAuth
        status.textContent = 'Preparing upload…'
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
<div class="login-field">
<label for="username">Username</label>
<input id="username" name="username" autocomplete="username" required>
</div>
<div class="login-field">
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
</div>
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
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Sign in', body, { mainClass: 'login-page' }))
}

export async function getGalleryPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<section id="files" aria-live="polite" aria-busy="true" class="gallery">
<span class="loading-indicator" role="status" aria-label="Loading files"></span></section>
<button id="load-more" type="button" hidden>Load more</button>
<dialog id="photo-viewer" class="photo-viewer" aria-label="Photo viewer">
<div class="viewer-layout">
<div class="viewer-stage">
<div class="viewer-toolbar"><span id="viewer-count" class="muted"></span>
<button id="viewer-close" type="button" aria-label="Close photo">×</button></div>
<div class="viewer-image-wrap"><img id="viewer-image" class="viewer-image" alt=""></div>
<div class="viewer-nav"><button id="viewer-prev" type="button" aria-label="Previous photo">‹</button>
<button id="viewer-next" type="button" aria-label="Next photo">›</button></div>
</div>
<aside id="viewer-info" class="viewer-info"></aside>
</div>
</dialog>
${authScript}
<script>
const root = document.querySelector('#files')
const loadMore = document.querySelector('#load-more')
const viewer = document.querySelector('#photo-viewer')
const viewerImage = document.querySelector('#viewer-image')
const viewerInfo = document.querySelector('#viewer-info')
const viewerCount = document.querySelector('#viewer-count')
const viewerFiles = []
let offset = 0
let previewCount = 0
let activePhotoIndex = 0
const showMessage = message => {
    root.setAttribute('aria-busy', 'false')
    root.replaceChildren()
    root.textContent = message
}
const openPhoto = index => {
    activePhotoIndex = index
    const file = viewerFiles[index]
    const url = fileUrl(file.id)
    viewerImage.src = url
    viewerImage.alt = file.name
    viewerCount.textContent = (index + 1) + ' of ' + viewerFiles.length
    const heading = document.createElement('h2')
    const type = document.createElement('p')
    const uploaded = document.createElement('p')
    const download = document.createElement('a')
    heading.textContent = file.name
    type.textContent = file.type
    uploaded.textContent = 'Uploaded ' + new Date(file.uploaded_at).toLocaleString()
    download.className = 'viewer-download'
    download.href = url
    download.download = file.name
    download.textContent = 'Download original'
    viewerInfo.replaceChildren(heading, type, uploaded, download)
    if (!viewer.open) viewer.showModal()
}
const movePhoto = step => openPhoto((activePhotoIndex + step + viewerFiles.length) % viewerFiles.length)
document.querySelector('#viewer-close').addEventListener('click', () => viewer.close())
document.querySelector('#viewer-prev').addEventListener('click', () => movePhoto(-1))
document.querySelector('#viewer-next').addEventListener('click', () => movePhoto(1))
viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close() })
viewer.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') movePhoto(-1)
    if (event.key === 'ArrowRight') movePhoto(1)
})
const appendFiles = files => {
    if (!offset) root.replaceChildren()
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
            const photoIndex = viewerFiles.push(file) - 1
            const preview = document.createElement('img')
            preview.className = 'preview'
            preview.src = url
            preview.alt = file.name
            preview.decoding = 'async'
            preview.loading = previewCount === 0 ? 'eager' : 'lazy'
            previewCount++
            summary.append(preview)
            summary.setAttribute('aria-label', 'View ' + file.name)
            summary.addEventListener('click', event => { event.preventDefault(); openPhoto(photoIndex) })
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
    root.setAttribute('aria-busy', 'false')
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
        if (!offset && !files.length) showMessage('No files yet.')
        else appendFiles(files)
    } catch (error) {
        if (!offset) showMessage(error.message || 'Your library could not be loaded.')
        else throw error
    } finally {
        loadMore.disabled = false
    }
}
loadMore.addEventListener('click', () => window.cdnAuth
    .then(auth => auth && fetchFiles(auth))
    .catch(error => { loadMore.textContent = error.message || 'Could not load more files.' }))
window.cdnAuth.then(auth => auth && fetchFiles(auth))
    .catch(error => showMessage(error.message || 'Your library could not be loaded.'))
</script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(
        shell('Your files', body, { mainClass: 'gallery-page', showBrand: false }),
    )
}
