import type { FastifyReply, FastifyRequest } from 'fastify'

const styles = `
:root { color-scheme: dark; font: 16px system-ui, sans-serif; background: #050505; color: #f6f6f3; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; padding: 2rem 1rem; display: grid; place-items: center; }
main { width: min(100%, 44rem); padding: 2rem; border: 1px solid #393939; border-radius: 1rem; background: #101010; }
a { color: inherit; }
header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
h1 { font-size: 2rem; margin: .5rem 0; }
p { color: #aaa; line-height: 1.5; }
input, button { font: inherit; border-radius: .6rem; padding: .75rem; }
input { width: 100%; background: #080808; color: #fff; border: 1px solid #393939; }
form { display: grid; gap: .5rem; }
button { border: 0; background: #f6f6f3; color: #111; font-weight: 600; cursor: pointer; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.actions { display: flex; gap: .75rem; align-items: center; margin: 1rem 0; }
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

export async function getUploadPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<p>Upload images, videos or files.</p>
<form id="upload">
<label for="file">Choose a file</label>
<div class="actions"><input id="file" name="file" type="file" required><button>Upload</button></div>
</form>
<p id="status" role="status"></p>
${authScript}
<script>
document.querySelector('#upload').addEventListener('submit', async event => {
    event.preventDefault()
    const file = document.querySelector('#file').files[0]
    const status = document.querySelector('#status')
    if (!file) return
    status.textContent = 'Uploading…'
    const data = new FormData()
    data.set('file', file)
    data.set('name', file.name)
    data.set('type', file.type || 'application/octet-stream')
    try {
        if (!await window.cdnAuth) return
        const response = await fetch('/api/files', { method: 'POST', body: data, credentials: 'same-origin' })
        if (response.status === 401) return login()
        const result = await response.json()
        if (!response.ok) throw Error(result.error || 'Upload failed.')
        status.textContent = 'Uploaded: '
        const link = document.createElement('a')
        link.href = fileUrl(result.id)
        link.textContent = location.origin + link.pathname
        status.append(link)
        if (/^image[/](jpeg|png|gif|webp|avif)$/i.test(file.type)) {
            const preview = document.createElement('img')
            preview.className = 'preview'
            preview.src = link.pathname
            preview.alt = file.name
            status.append(preview)
        }
    } catch (error) {
        status.textContent = error.message || 'Upload failed.'
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
${authScript}
<script>
const root = document.querySelector('#files')
let previewCount = 0
window.cdnAuth.then(auth => auth && fetch(
    '/api/files/user/' + encodeURIComponent(auth.id),
    { cache: 'no-store', credentials: 'same-origin' },
))
    .then(async response => {
        if (!response) return null
        if (response.status === 401) return login()
        if (!response.ok) throw Error('Your library could not be loaded.')
        return response.json()
    })
    .then(files => {
        if (!files) return
        root.textContent = ''
        if (!files.length) { root.textContent = 'No files yet.'; return }
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
    })
    .catch(error => { root.textContent = error.message || 'Your library could not be loaded.' })
</script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Your files', body))
}
