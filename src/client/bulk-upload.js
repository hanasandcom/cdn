/* global window, document, indexedDB, XMLHttpRequest, FormData, setTimeout, clearTimeout, location, crypto, fetch */
(() => {
    const form = document.querySelector('#upload')
    const picker = document.querySelector('#picker')
    if (!form || !picker) return

    const status = document.querySelector('#status')
    const submit = form.querySelector('.upload-submit')
    const pause = document.querySelector('#pause-upload')
    const byFile = new Map()
    const dbName = 'hanasand-cdn-imports'
    let accountId = ''
    let saved = []
    let activeRequest = null
    let running = false
    let paused = false
    let saveTimer = 0

    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const signature = file => JSON.stringify([
        file.webkitRelativePath || file.name, file.size, file.lastModified, file.type || '',
    ])
    const openDb = () => new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)
        request.onupgradeneeded = () => request.result.createObjectStore('imports', { keyPath: 'accountId' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    const dbRequest = async (mode, callback) => {
        const db = await openDb()
        return new Promise((resolve, reject) => {
            const transaction = db.transaction('imports', mode)
            const request = callback(transaction.objectStore('imports'))
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
            transaction.oncomplete = () => db.close()
            transaction.onerror = () => { db.close(); reject(transaction.error) }
        })
    }
    const persistQueue = async () => {
        if (!accountId) return
        const pending = [...saved]
        for (const item of byFile.values()) {
            pending.push({
                key: item.key, signature: item.signature, name: item.file.name,
                size: item.file.size, lastModified: item.file.lastModified,
                type: item.file.type, id: item.id,
                state: item.state === 'uploading' ? 'queued' : item.state,
            })
        }
        const unique = [...new Map(pending.map(item => [item.key, item])).values()]
        try {
            const unfinished = unique.some(item => item.state !== 'uploaded')
            if (unfinished) await dbRequest('readwrite', store => store.put({ accountId, files: unique }))
            else await dbRequest('readwrite', store => store.delete(accountId))
            saved = unfinished ? unique : []
            updateRecoveryHint()
        } catch {
            status.textContent = 'Upload recovery could not be saved on this device.'
        }
    }
    const saveQueue = () => {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => { void persistQueue() }, 150)
    }
    const updateRecoveryHint = () => {
        let hint = document.querySelector('#resume-hint')
        const remaining = saved.filter(item => item.state !== 'uploaded').length
        if (!remaining) { hint?.remove(); return }
        if (!hint) {
            hint = document.createElement('p')
            hint.id = 'resume-hint'
            hint.className = 'upload-hint'
            form.after(hint)
        }
        hint.textContent = `Select the original files to resume this import (${remaining} remaining).`
    }
    const refreshSummary = () => {
        const items = [...byFile.values()]
        const uploaded = items.filter(item => item.state === 'uploaded').length
        const failed = items.filter(item => item.state === 'failed').length
        const current = items.find(item => item.state === 'uploading')
        if (!running) {
            submit.textContent = failed ? 'Retry failed files'
                : paused || items.some(item => item.resuming && item.state !== 'uploaded') ? 'Resume upload' : 'Upload'
        }
        status.textContent = current
            ? `Uploading ${uploaded} of ${items.length} · ${current.file.name} ${current.progress || 0}%`
            : failed ? `${uploaded} of ${items.length} uploaded · ${failed} need retry`
                : items.length && uploaded === items.length ? `${uploaded} files uploaded.` : ''
    }
    const setState = (item, state, label, progress, error) => {
        item.state = state
        item.progress = progress
        item.error = error
        picker.setUploadState(item.file, { label, progress, error })
        refreshSummary()
        saveQueue()
    }
    const setIdleState = (item, label, error) => {
        item.state = error ? 'failed' : 'queued'
        item.progress = undefined
        item.error = error
        picker.setUploadState(item.file, { label, error })
        refreshSummary()
        saveQueue()
    }
    const xhrRequest = (url, data, headers, progressItems) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        activeRequest = xhr
        xhr.open('POST', url)
        xhr.withCredentials = true
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
        xhr.upload.onprogress = event => {
            if (!event.lengthComputable) return
            let remaining = event.loaded
            for (const item of progressItems) {
                const sent = Math.min(item.file.size, Math.max(0, remaining))
                remaining -= sent
                const progress = Math.min(99, Math.floor(sent / Math.max(1, item.file.size) * 100))
                setState(item, 'uploading', 'Uploading', progress)
            }
        }
        xhr.onload = () => {
            activeRequest = null
            let result
            try { result = JSON.parse(xhr.responseText || '{}') }
            catch { return reject(new Error('The server returned an invalid response.')) }
            resolve({ status: xhr.status, result, retryAfter: xhr.getResponseHeader('Retry-After') })
        }
        xhr.onerror = () => { activeRequest = null; reject(new Error('Connection interrupted. Retry is safe.')) }
        xhr.onabort = () => { activeRequest = null; resolve({ aborted: true }) }
        xhr.send(data)
    })
    const postItems = async items => {
        const single = items.length === 1
        const data = new FormData()
        if (single) {
            const item = items[0]
            data.set('file', item.file)
            data.set('name', item.file.name)
            data.set('type', item.file.type || 'application/octet-stream')
        } else {
            for (const item of items) data.append(`files:${item.key}`, item.file, item.file.name)
        }
        while (!paused) {
            try {
                const headers = single
                    ? { 'X-CDN-Upload-Key': items[0].key }
                    : { 'X-CDN-Upload-Count': String(items.length) }
                const response = await xhrRequest(single ? '/api/files' : '/api/files/bulk', data,
                    headers, items)
                if (response.aborted) return false
                if (response.status === 401) {
                    location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
                    return false
                }
                if (response.status === 429) {
                    const delay = Math.max(1, Number(response.retryAfter) || 1)
                    status.textContent = `Upload paused by the server for ${delay} second${delay === 1 ? '' : 's'}.`
                    await wait(delay * 1000)
                    continue
                }
                if (response.status < 200 || response.status >= 300) throw new Error(response.result.error || 'Upload failed.')
                const uploaded = single ? [response.result] : response.result.uploaded || []
                const failed = single ? [] : response.result.failed || []
                const uploadedKeys = new Set()
                for (const result of uploaded) {
                    const item = items.find(candidate => candidate.key === result.uploadKey) || (single ? items[0] : null)
                    if (!item) continue
                    item.id = result.id
                    item.state = 'uploaded'
                    item.progress = 100
                    item.error = ''
                    uploadedKeys.add(item.key)
                    picker.setUploadState(item.file, { label: 'Uploaded', progress: 100 })
                }
                for (const result of failed) {
                    const item = items.find(candidate => candidate.key === result.uploadKey)
                    if (item) setIdleState(item, 'Upload failed', result.error || 'Upload failed.')
                }
                for (const item of items) {
                    if (uploadedKeys.has(item.key) || failed.some(result => result.uploadKey === item.key)) continue
                    setIdleState(item, 'Upload failed', 'No result was received. Retry is safe.')
                }
                refreshSummary()
                saveQueue()
                return true
            } catch (error) {
                if (paused) return false
                for (const item of items) setIdleState(item, 'Upload interrupted', error.message || 'Retry is safe.')
                return true
            }
        }
        return false
    }
    const makeBatches = items => {
        const batches = []
        let batch = []
        let bytes = 0
        for (const item of items) {
            if (batch.length && (batch.length >= 5000 || bytes + item.file.size > 45 * 1024 * 1024)) {
                batches.push(batch)
                batch = []
                bytes = 0
            }
            batch.push(item)
            bytes += item.file.size
            if (item.file.size > 45 * 1024 * 1024) { batches.push(batch); batch = []; bytes = 0 }
        }
        if (batch.length) batches.push(batch)
        return batches
    }
    const ensureQueueItems = files => {
        const available = saved.slice()
        for (const file of files) {
            if (byFile.has(file)) continue
            const fileSignature = signature(file)
            const index = available.findIndex(item => item.signature === fileSignature)
            const previous = index < 0 ? null : available.splice(index, 1)[0]
            const item = {
                key: previous?.key || crypto.randomUUID(), file, signature: fileSignature,
                state: previous?.state === 'uploaded' ? 'uploaded' : 'queued',
                id: previous?.id, error: '', progress: previous?.state === 'uploaded' ? 100 : 0,
                resuming: Boolean(previous && previous.state !== 'uploaded'),
            }
            byFile.set(file, item)
            if (item.state === 'uploaded') picker.setUploadState(file, { label: 'Uploaded', progress: 100 })
            else if (previous) picker.setUploadState(file, { label: 'Ready to resume' })
        }
        saved = available
        updateRecoveryHint()
        refreshSummary()
        saveQueue()
        return files.map(file => byFile.get(file))
    }
    const run = async requestedItems => {
        if (running || !requestedItems.length) return
        running = true
        paused = false
        picker.setAttribute('disabled', '')
        submit.disabled = true
        pause.hidden = false
        pause.textContent = 'Pause'
        try {
            const batches = makeBatches(requestedItems.filter(item => item.state !== 'uploaded'))
            for (const batch of batches) {
                if (paused) break
                for (const item of batch) setState(item, 'uploading', 'Preparing', 0)
                await persistQueue()
                const completed = await postItems(batch)
                if (!completed) {
                    if (paused) for (const item of batch) setIdleState(item, 'Paused')
                    break
                }
            }
        } finally {
            running = false
            activeRequest = null
            picker.removeAttribute('disabled')
            submit.disabled = picker.files.every(file => byFile.get(file)?.state === 'uploaded')
            pause.hidden = true
            refreshSummary()
            saveQueue()
        }
    }

    const addLink = (parent, url, text) => {
        const link = document.createElement('a')
        link.href = url
        link.textContent = text
        parent.append(link)
    }
    const uploadGuest = async files => {
        const links = []
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            status.textContent = `Uploading ${i + 1} of ${files.length} files…`
            const data = new FormData()
            data.set('file', file)
            data.set('name', file.name)
            data.set('type', file.type || 'application/octet-stream')
            let response
            do {
                response = await fetch('/api/files', { method: 'POST', body: data, credentials: 'same-origin' })
                if (response.status === 429) await wait(Math.max(1, Number(response.headers.get('Retry-After')) || 1) * 1000)
            } while (response.status === 429)
            const result = await response.json()
            if (!response.ok) throw new Error(result.error || 'Upload failed.')
            links.push({ url: '/api/files/' + encodeURIComponent(result.id), name: file.name, type: file.type })
            if (i < files.length - 1) await wait(1000)
        }
        status.replaceChildren()
        for (const item of links) {
            const row = document.createElement('p')
            addLink(row, item.url, item.name + ' · ' + location.origin + item.url)
            status.append(row)
        }
    }

    picker.addEventListener('fileschange', () => { submit.disabled = running || !picker.files.length })
    picker.addEventListener('retryfile', event => {
        const item = byFile.get(event.detail.file)
        if (item) run([item])
    })
    pause.addEventListener('click', () => {
        if (!running) return
        paused = true
        pause.textContent = 'Pausing…'
        activeRequest?.abort()
    })
    form.addEventListener('submit', async event => {
        event.preventDefault()
        const files = picker.files
        if (!files.length || running) return
        try {
            const auth = await window.cdnAuth
            if (!auth) {
                picker.setAttribute('disabled', '')
                submit.disabled = true
                try { await uploadGuest(files) } finally {
                    picker.removeAttribute('disabled')
                    submit.disabled = !picker.files.length
                }
                return
            }
            if (!accountId) {
                accountId = auth.id
                const record = await dbRequest('readonly', store => store.get(accountId))
                saved = record?.files || []
            }
            await run(ensureQueueItems(files))
        } catch (error) {
            status.textContent = error.message || 'Upload failed.'
        }
    })

    window.cdnAuth.then(async auth => {
        if (!auth) return
        try {
            accountId = auth.id
            const record = await dbRequest('readonly', store => store.get(accountId))
            saved = record?.files || []
            updateRecoveryHint()
        } catch {
            status.textContent = 'Upload recovery is unavailable in this browser.'
        }
    }).catch(() => {})
})()
