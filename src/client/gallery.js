/* global window, document, location, navigator, fetch, Option */
(() => {
    const page = document.querySelector('#photo-library')
    if (!page) return

    const root = document.querySelector('#files')
    const title = document.querySelector('#view-title')
    const loadMore = document.querySelector('#load-more')
    const albumTarget = document.querySelector('#album-target')
    const addButton = document.querySelector('#add-to-album')
    const manageButton = document.querySelector('#manage-album')
    const selectionCount = document.querySelector('#selection-count')
    const viewer = document.querySelector('#photo-viewer')
    const viewerImage = document.querySelector('#viewer-image')
    const viewerVideo = document.querySelector('#viewer-video')
    const viewerInfo = document.querySelector('#viewer-info')
    const viewerCount = document.querySelector('#viewer-count')
    const dialog = document.querySelector('#album-form')
    const publicToken = page.dataset.publicToken || ''
    const isPublic = Boolean(publicToken)
    const state = {
        files: [], allFiles: [], albums: [], activeAlbum: null, view: 'library', selected: new Set(),
        offset: 0, albumOffset: 0, photos: [], photoIndex: 0,
    }
    const fileUrl = id => '/api/files/' + encodeURIComponent(id)
    const api = async (url, options = {}) => {
        const response = await fetch(url, {
            credentials: 'same-origin', cache: 'no-store', ...options,
        })
        const result = await response.json().catch(() => null)
        if (!response.ok) {
            if (response.status === 401 && !isPublic) {
                location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
                throw Error('Sign in required.')
            }
            throw Error(result?.error || 'The photo library could not be loaded.')
        }
        return result
    }
    const formatDate = value => {
        if (!value) return ''
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
            day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(date)
    }
    const groupDate = file => {
        const date = new Date(file.photo_taken_at || file.uploaded_at)
        if (Number.isNaN(date.getTime())) return 'Date unknown'
        return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date)
    }
    const locationLabel = file => {
        const coordinates = file.latitude !== null && file.latitude !== undefined
            && file.longitude !== null && file.longitude !== undefined
            && Number.isFinite(Number(file.latitude)) && Number.isFinite(Number(file.longitude))
            ? `${Number(file.latitude).toFixed(4)}, ${Number(file.longitude).toFixed(4)}` : ''
        return [file.location_label, coordinates].filter(Boolean).join(' · ')
    }
    const showError = message => {
        root.setAttribute('aria-busy', 'false')
        root.replaceChildren()
        const paragraph = document.createElement('p')
        paragraph.className = 'muted'
        paragraph.textContent = message
        root.append(paragraph)
        page.setAttribute('aria-busy', 'false')
    }
    const updateSelection = () => {
        const count = state.selected.size
        selectionCount.hidden = !count
        selectionCount.textContent = count ? `${count} selected` : ''
        addButton.disabled = count === 0 || !albumTarget.value
    }
    const appendMeta = (container, icon, label, value) => {
        if (!value) return
        const line = document.createElement('p')
        line.textContent = `${icon} ${label}: ${value}`
        container.append(line)
    }
    const openPhoto = index => {
        state.photoIndex = index
        const file = state.photos[index]
        const url = fileUrl(file.id)
        const isVideo = /^video\/(mp4|webm|ogg)$/i.test(file.type)
        viewerImage.hidden = isVideo
        viewerVideo.hidden = !isVideo
        viewerVideo.pause()
        viewerVideo.removeAttribute('src')
        if (isVideo) {
            viewerVideo.src = url
            viewerVideo.load()
        } else {
            viewerImage.src = url
            viewerImage.alt = file.name
        }
        viewerCount.textContent = `${index + 1} of ${state.photos.length}`
        const heading = document.createElement('h2')
        heading.textContent = file.name
        viewerInfo.replaceChildren(heading)
        appendMeta(viewerInfo, '◷', 'Taken', formatDate(file.photo_taken_at))
        appendMeta(viewerInfo, '◉', 'Location', locationLabel(file))
        appendMeta(viewerInfo, '▤', 'Size', Number(file.size_bytes) ? `${(Number(file.size_bytes) / 1024).toFixed(0)} KB` : '')
        appendMeta(viewerInfo, '◷', 'Uploaded', formatDate(file.uploaded_at))
        const download = document.createElement('a')
        download.className = 'viewer-download'
        download.href = url
        download.download = file.name
        download.textContent = 'Download original'
        viewerInfo.append(download)
        if (!viewer.open) viewer.showModal()
    }
    const movePhoto = step => {
        if (!state.photos.length) return
        openPhoto((state.photoIndex + step + state.photos.length) % state.photos.length)
    }
    document.querySelector('#viewer-close')?.addEventListener('click', () => viewer.close())
    document.querySelector('#viewer-prev')?.addEventListener('click', () => movePhoto(-1))
    document.querySelector('#viewer-next')?.addEventListener('click', () => movePhoto(1))
    viewer?.addEventListener('click', event => { if (event.target === viewer) viewer.close() })
    viewer?.addEventListener('close', () => {
        viewerVideo.pause()
        viewerVideo.removeAttribute('src')
        viewerVideo.load()
    })
    viewer?.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') movePhoto(-1)
        if (event.key === 'ArrowRight') movePhoto(1)
    })

    const renderSidebar = () => {
        const owned = document.querySelector('#owned-albums')
        const shared = document.querySelector('#shared-albums')
        if (!owned || !shared) return
        owned.replaceChildren()
        shared.replaceChildren()
        albumTarget.replaceChildren(new Option('Add to album', ''))
        for (const album of state.albums) {
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'album-nav'
            button.textContent = `▱ ${album.name}`
            const count = document.createElement('span')
            count.className = 'count'
            count.textContent = album.photo_count
            button.append(count)
            button.setAttribute('aria-current', state.activeAlbum?.id === album.id ? 'page' : 'false')
            button.addEventListener('click', () => openAlbum(album.id))
            ;(album.owner === window.cdnAuthUser?.id ? owned : shared).append(button)
            albumTarget.add(new Option(album.name, album.id))
        }
    }

    const renderFiles = () => {
        root.setAttribute('aria-busy', 'false')
        page.setAttribute('aria-busy', 'false')
        root.replaceChildren()
        const filtered = state.files.filter(file => /^image\/(jpeg|png|gif|webp|avif)$/i.test(file.type)
            || /^video\/(mp4|webm|ogg)$/i.test(file.type))
            .sort((a, b) => new Date(b.photo_taken_at || b.uploaded_at) - new Date(a.photo_taken_at || a.uploaded_at))
        state.photos = filtered
        if (!filtered.length) {
            const empty = document.createElement('p')
            empty.className = 'muted'
            empty.textContent = state.activeAlbum ? 'This album is empty.' : 'No photos yet.'
            root.append(empty)
            return
        }
        const groups = new Map()
        for (const file of filtered) {
            const key = `${groupDate(file)}\u0000${locationLabel(file)}`
            if (!groups.has(key)) groups.set(key, [])
            groups.get(key).push(file)
        }
        let firstImage = true
        for (const [key, files] of groups) {
            const [dateLabel, placeLabel] = key.split('\u0000')
            const section = document.createElement('section')
            section.className = 'photo-group'
            const heading = document.createElement('div')
            heading.className = 'photo-group-heading'
            const dateHeading = document.createElement('h3')
            dateHeading.textContent = dateLabel
            heading.append(dateHeading)
            if (placeLabel) {
                const place = document.createElement('span')
                place.textContent = `⌖ ${placeLabel}`
                heading.append(place)
            }
            const grid = document.createElement('div')
            grid.className = 'photo-grid'
            for (const file of files) {
                const card = document.createElement('article')
                card.className = 'photo-card'
                const open = document.createElement('button')
                open.type = 'button'
                open.setAttribute('aria-label', `View ${file.name}`)
                const isVideo = /^video\/(mp4|webm|ogg)$/i.test(file.type)
                const preview = document.createElement(isVideo ? 'video' : 'img')
                preview.className = 'preview'
                preview.src = fileUrl(file.id)
                preview.decoding = 'async'
                preview.loading = firstImage ? 'eager' : 'lazy'
                if (isVideo) {
                    preview.muted = true
                    preview.playsInline = true
                    preview.preload = 'metadata'
                    preview.setAttribute('aria-label', file.name)
                } else preview.alt = file.name
                firstImage = false
                open.append(preview)
                const photoIndex = state.photos.indexOf(file)
                open.addEventListener('click', () => openPhoto(photoIndex))
                card.append(open)
                if (!isPublic) {
                    const checkbox = document.createElement('input')
                    checkbox.type = 'checkbox'
                    checkbox.className = 'photo-select'
                    checkbox.checked = state.selected.has(file.id)
                    checkbox.setAttribute('aria-label', `Select ${file.name}`)
                    checkbox.addEventListener('click', event => event.stopPropagation())
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) state.selected.add(file.id)
                        else state.selected.delete(file.id)
                        updateSelection()
                    })
                    card.append(checkbox)
                    const canRemove = state.activeAlbum && (state.activeAlbum.role === 'owner'
                        || (state.activeAlbum.role === 'contributor' && file.added_by === window.cdnAuthUser?.id))
                    if (canRemove) {
                        const remove = document.createElement('button')
                        remove.className = 'album-remove'
                        remove.type = 'button'
                        remove.textContent = '×'
                        remove.setAttribute('aria-label', `Remove ${file.name} from album`)
                        remove.addEventListener('click', async () => {
                            const albumId = encodeURIComponent(state.activeAlbum.id)
                            await api(`/api/albums/${albumId}/items/${encodeURIComponent(file.id)}`, { method: 'DELETE' })
                            state.files = state.files.filter(item => item.id !== file.id)
                            renderFiles()
                        })
                        card.append(remove)
                    }
                }
                grid.append(card)
            }
            section.append(heading, grid)
            root.append(section)
        }
    }

    const openAlbum = async id => {
        try {
            const album = await api(`/api/albums/${encodeURIComponent(id)}`)
            state.activeAlbum = album
            state.view = 'album'
            state.files = album.items
            state.albumOffset = album.items.length
            state.selected.clear()
            title.textContent = album.name
            manageButton.hidden = album.role !== 'owner'
            loadMore.hidden = album.items.length < album.total
            renderSidebar()
            updateSelection()
            renderFiles()
        } catch (error) { showError(error.message) }
    }

    const dialogForm = (heading, fields, onSubmit) => {
        dialog.replaceChildren()
        const form = document.createElement('form')
        const titleNode = document.createElement('h2')
        titleNode.textContent = heading
        form.append(titleNode)
        for (const field of fields) form.append(field)
        const error = document.createElement('p')
        error.className = 'muted'
        error.hidden = true
        const actions = document.createElement('div')
        actions.className = 'dialog-actions'
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = 'Cancel'
        cancel.addEventListener('click', () => dialog.close())
        const submit = document.createElement('button')
        submit.type = 'submit'
        submit.className = 'primary'
        submit.textContent = 'Save'
        actions.append(cancel, submit)
        form.append(error, actions)
        form.addEventListener('submit', async event => {
            event.preventDefault()
            submit.disabled = true
            try { await onSubmit(form); dialog.close() } catch (cause) { error.textContent = cause.message; error.hidden = false }
            finally { submit.disabled = false }
        })
        dialog.append(form)
        dialog.showModal()
    }
    const field = (labelText, name, type = 'text') => {
        const label = document.createElement('label')
        label.append(document.createTextNode(labelText))
        const input = document.createElement('input')
        input.name = name
        input.type = type
        input.required = true
        label.append(input)
        return label
    }
    document.querySelector('#create-album')?.addEventListener('click', () => {
        const name = field('Album name', 'name')
        dialogForm('New album', [name], async form => {
            const album = await api('/api/albums', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.elements.name.value }),
            })
            state.albums.unshift(album)
            renderSidebar()
            await openAlbum(album.id)
        })
    })
    albumTarget?.addEventListener('change', updateSelection)
    addButton?.addEventListener('click', async () => {
        if (!albumTarget.value || !state.selected.size) return
        const id = albumTarget.value
        await api(`/api/albums/${encodeURIComponent(id)}/items`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileIds: [...state.selected] }),
        })
        state.selected.clear()
        await loadAlbums()
        updateSelection()
        if (state.activeAlbum?.id === id) await openAlbum(id)
    })
    manageButton?.addEventListener('click', () => {
        const album = state.activeAlbum
        if (!album || album.role !== 'owner') return
        const name = field('Album name', 'name')
        name.querySelector('input').value = album.name
        const invite = field('Hanasand account ID', 'userId')
        invite.querySelector('input').required = false
        const role = document.createElement('label')
        role.append(document.createTextNode('Access'))
        const select = document.createElement('select')
        select.name = 'role'
        select.add(new Option('View photos', 'viewer'))
        select.add(new Option('Add photos', 'contributor'))
        role.append(select)
        const share = document.createElement('label')
        const toggle = document.createElement('input')
        toggle.type = 'checkbox'
        toggle.name = 'isPublic'
        toggle.checked = album.is_public
        share.append(toggle, document.createTextNode(' Allow anyone with a link to view'))
        const members = document.createElement('div')
        for (const member of album.members || []) {
            const row = document.createElement('p')
            row.textContent = `${member.user_id} · ${member.role} `
            const remove = document.createElement('button')
            remove.type = 'button'
            remove.className = 'danger'
            remove.textContent = 'Remove'
            remove.addEventListener('click', async () => {
                await api(
                    `/api/albums/${encodeURIComponent(album.id)}/members/${encodeURIComponent(member.user_id)}`,
                    { method: 'DELETE' },
                )
                row.remove()
            })
            row.append(remove)
            members.append(row)
        }
        const deleteAlbum = document.createElement('button')
        deleteAlbum.type = 'button'
        deleteAlbum.className = 'danger'
        deleteAlbum.textContent = 'Delete album'
        deleteAlbum.addEventListener('click', async () => {
            if (!window.confirm(`Delete “${album.name}”? The uploaded photos will stay in your library.`)) return
            try {
                await api(`/api/albums/${encodeURIComponent(album.id)}`, { method: 'DELETE' })
                state.albums = state.albums.filter(item => item.id !== album.id)
                state.activeAlbum = null
                state.view = 'library'
                state.files = state.allFiles
                title.textContent = 'Library'
                manageButton.hidden = true
                loadMore.hidden = state.offset < 100
                dialog.close()
                renderSidebar()
                renderFiles()
            } catch (error) {
                const status = dialog.querySelector('form p')
                status.textContent = error.message
                status.hidden = false
            }
        })
        const fields = [name, invite, role, share, members, deleteAlbum]
        dialogForm('Album sharing', fields, async form => {
            const newName = form.elements.name.value
            const isPublicNow = form.elements.isPublic.checked
            const updated = await api(`/api/albums/${encodeURIComponent(album.id)}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName, isPublic: isPublicNow }),
            })
            if (form.elements.userId.value.trim()) await api(`/api/albums/${encodeURIComponent(album.id)}/members`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: form.elements.userId.value.trim(), role: form.elements.role.value }),
            })
            state.activeAlbum.name = updated.name
            state.activeAlbum.is_public = updated.is_public
            state.activeAlbum.members = album.members
            if (updated.public_token) {
                const shareUrl = `${location.origin}/shared/${encodeURIComponent(updated.public_token)}`
                try { await navigator.clipboard.writeText(shareUrl) } catch { /* The link remains available in the next prompt. */ }
                window.alert(`Public album link:\n${shareUrl}`)
            }
            await loadAlbums()
            title.textContent = updated.name
        })
    })
    document.querySelectorAll('.library-nav').forEach(button => button.addEventListener('click', () => {
        state.view = button.dataset.view
        state.activeAlbum = null
        state.selected.clear()
        state.files = state.view === 'recent'
            ? [...state.allFiles].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)).slice(0, 100)
            : state.allFiles
        title.textContent = state.view === 'recent' ? 'Recent' : 'Library'
        document.querySelectorAll('.library-nav').forEach(item => item.setAttribute('aria-current', item === button ? 'page' : 'false'))
        manageButton.hidden = true
        loadMore.hidden = state.view === 'recent' || state.offset < 100
        updateSelection()
        renderFiles()
    }))
    loadMore?.addEventListener('click', () => loadMoreFiles().catch(error => { loadMore.textContent = error.message }))

    async function loadAlbums() {
        state.albums = await api('/api/albums')
        renderSidebar()
    }
    async function loadMoreFiles() {
        if (isPublic) {
            loadMore.disabled = true
            try {
                const next = await api(`/api/albums/public/${encodeURIComponent(publicToken)}?limit=100&offset=${state.albumOffset}`)
                state.files.push(...next.items)
                state.albumOffset += next.items.length
                state.activeAlbum = next
                loadMore.hidden = state.albumOffset >= next.total
                renderFiles()
            } finally { loadMore.disabled = false }
            return
        }
        if (!window.cdnAuthUser) return
        if (state.view === 'album' && state.activeAlbum) {
            loadMore.disabled = true
            try {
                const next = await api(`/api/albums/${encodeURIComponent(state.activeAlbum.id)}?limit=100&offset=${state.albumOffset}`)
                state.files.push(...next.items)
                state.activeAlbum = { ...next, items: state.files }
                state.albumOffset += next.items.length
                loadMore.hidden = state.albumOffset >= next.total
                renderFiles()
            } finally { loadMore.disabled = false }
            return
        }
        loadMore.disabled = true
        try {
            const next = await api(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?limit=100&offset=${state.offset}`)
            state.offset += next.length
            state.allFiles.push(...next)
            state.files = state.view === 'recent'
                ? [...state.allFiles].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)).slice(0, 100)
                : state.allFiles
            loadMore.hidden = next.length < 100 || state.view === 'recent'
            renderFiles()
        } finally { loadMore.disabled = false }
    }
    if (isPublic) {
        document.querySelector('.library-sidebar')?.remove()
        page.style.gridTemplateColumns = 'minmax(0,1fr)'
        Promise.all([api(`/api/albums/public/${encodeURIComponent(publicToken)}?limit=100&offset=0`)]).then(([album]) => {
            title.textContent = album.name
            state.files = album.items
            state.albumOffset = album.items.length
            state.activeAlbum = album
            loadMore.hidden = state.albumOffset >= album.total
            renderFiles()
        }).catch(error => showError(error.message))
    } else {
        window.cdnAuth.then(async auth => {
            if (!auth?.id) return location.replace('/login?returnTo=%2Fgallery')
            window.cdnAuthUser = auth
            const [, files] = await Promise.all([
                loadAlbums(),
                api(`/api/files/user/${encodeURIComponent(auth.id)}?limit=100&offset=0`),
            ])
            state.allFiles = files
            state.files = files
            state.offset = files.length
            loadMore.hidden = files.length < 100
            renderFiles()
        }).catch(error => showError(error.message || 'The photo library could not be loaded.'))
    }
})()
