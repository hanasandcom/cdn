const DB_NAME = 'hanasand-device-proof-worker'

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
    const message = event.data
    if (message?.channel !== 'hanasand-device-proof' || message.type !== 'initialize') return
    event.waitUntil(storeDevice(message.privateKey, message.publicJwk, message.tokenHash))
})

self.addEventListener('fetch', event => {
    const request = event.request
    const url = new URL(request.url)
    if (url.origin !== self.location.origin || !needsProof(request, url) || request.headers.has('DPoP')) return

    event.respondWith((async () => {
        const device = await loadDevice()
        if (!device?.privateKey || !device.publicJwk || !device.tokenHash) return fetch(request)
        const proof = await createProof(device, request.method, url)
        const headers = new Headers(request.headers)
        headers.set('DPoP', proof)
        headers.set('X-Device-Public-Jwk', JSON.stringify(device.publicJwk))
        return fetch(new Request(request, { headers }))
    })())
})

function needsProof(request, url) {
    if (request.mode === 'navigate') return true
    if (!url.pathname.startsWith('/api/')) return false
    if (url.pathname === '/api/health' || url.pathname === '/api/status') return false
    if (/^\/api\/files\/[0-9a-f-]{36}$/i.test(url.pathname) && ['GET', 'HEAD'].includes(request.method)) return false
    return true
}

async function createProof(device, method, url) {
    url.search = ''
    url.hash = ''
    const claims = {
        htm: method.toUpperCase(),
        htu: url.toString().replace(/\/$/, ''),
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
        ath: device.tokenHash,
    }
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: device.publicJwk }
    const input = `${encode(header)}.${encode(claims)}`
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.privateKey, new TextEncoder().encode(input))
    return `${input}.${toBase64Url(new Uint8Array(signature))}`
}

function encode(value) { return toBase64Url(new TextEncoder().encode(JSON.stringify(value))) }
function toBase64Url(bytes) {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => request.result.createObjectStore('device')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function storeDevice(privateKey, publicJwk, tokenHash) {
    const database = await openDatabase()
    return new Promise((resolve, reject) => {
        const request = database.transaction('device', 'readwrite').objectStore('device').put({ privateKey, publicJwk, tokenHash }, 'current')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

async function loadDevice() {
    const database = await openDatabase()
    return new Promise((resolve, reject) => {
        const request = database.transaction('device').objectStore('device').get('current')
        request.onsuccess = () => resolve(request.result || null)
        request.onerror = () => reject(request.error)
    })
}
