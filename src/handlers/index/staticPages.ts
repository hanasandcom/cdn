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
.file { border-top: 1px solid #393939; padding: 1rem 0; overflow-wrap: anywhere; }
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
const cookies = Object.fromEntries(document.cookie.split(';').map(part => {
    const [key, ...value] = part.trim().split('=')
    return [decodeURIComponent(key), decodeURIComponent(value.join('='))]
}))
const auth = { id: cookies.id || '', Authorization: 'Bearer ' + (cookies.access_token || '') }
const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
if (!auth.id || auth.Authorization === 'Bearer ') login()
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
        const response = await fetch('/api/files', { method: 'POST', headers: auth, body: data })
        if (response.status === 401) return login()
        const result = await response.json()
        if (!response.ok) throw Error(result.error || 'Upload failed.')
        status.textContent = 'Uploaded: '
        const link = document.createElement('a')
        link.href = '/files/' + encodeURIComponent(result.id)
        link.textContent = location.origin + link.pathname
        status.append(link)
    } catch (error) {
        status.textContent = error.message || 'Upload failed.'
    }
})
</script>`
    return res.type('text/html').send(shell('Upload media', body))
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
    return res.type('text/html').send(shell('Sign in', body))
}

export async function getGalleryPage(_req: FastifyRequest, res: FastifyReply) {
    const body = `<p>Your uploaded files and share links.</p>
<section id="files" aria-live="polite" class="muted">Loading…</section>
${authScript}
<script>
const root = document.querySelector('#files')
fetch('/api/files/user/' + encodeURIComponent(auth.id), { headers: auth })
    .then(async response => {
        if (response.status === 401) return login()
        if (!response.ok) throw Error('Your library could not be loaded.')
        return response.json()
    })
    .then(files => {
        root.textContent = ''
        if (!files.length) { root.textContent = 'No files yet.'; return }
        for (const file of files) {
            const row = document.createElement('article')
            const link = document.createElement('a')
            const meta = document.createElement('p')
            row.className = 'file'
            link.href = '/files/' + encodeURIComponent(file.id)
            link.textContent = file.name
            meta.className = 'muted'
            meta.textContent = file.type + ' · ' + new Date(file.uploaded_at).toLocaleString()
            row.append(link, meta)
            root.append(row)
        }
    })
    .catch(error => { root.textContent = error.message || 'Your library could not be loaded.' })
</script>`
    return res.type('text/html').send(shell('Your files', body))
}
