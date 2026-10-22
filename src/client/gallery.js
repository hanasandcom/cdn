/* global window, document, location, navigator, fetch, Option, URLSearchParams, clearTimeout, setTimeout */
(() => {
    const page = document.querySelector('#photo-library')
    if (!page) return

    const root = document.querySelector('#files')
    const title = document.querySelector('#view-title')
    const dateTimeline = document.querySelector('#date-timeline')
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
    const searchInput = document.querySelector('#photo-search')
    const publicToken = page.dataset.publicToken || ''
    const isPublic = Boolean(publicToken)
    const state = {
        files: [], allFiles: [], recentFiles: [], albums: [], activeAlbum: null,
        view: 'library', selected: new Set(), offset: 0, recentOffset: 0,
        albumOffset: 0, photos: [], photoIndex: 0, search: '', month: '', months: [], searchRequest: 0,
    }
    const fileUrl = (id, thumbnail = false) => '/api/files/' + encodeURIComponent(id)
        + (thumbnail ? '?variant=thumbnail' : '')
    const appendQuery = (url, params) => params.size
        ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url
    const withSearch = url => {
        const filters = new URLSearchParams()
        if (state.search) filters.set('search', state.search)
        if (!isPublic && state.view === 'favorites') filters.set('favorites', 'true')
        if (!isPublic) filters.set('media',
            state.view === 'images' || state.view === 'videos' ? state.view : 'all')
        return appendQuery(url, filters)
    }
    const withFilters = url => {
        const filteredUrl = withSearch(url)
        if (!state.month) return filteredUrl
        return appendQuery(filteredUrl, new URLSearchParams({ month: state.month }))
    }
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
    const photoDate = file => {
        const date = new Date(file.photo_taken_at || file.uploaded_at)
        if (!file.photo_taken_at || Number.isNaN(date.getTime())) return date
        const offset = Number(file.photo_taken_offset_minutes)
        return Number.isFinite(offset) ? new Date(date.getTime() + offset * 60_000) : date
    }
    const formatTakenDate = file => {
        if (!file.photo_taken_at) return ''
        const date = photoDate(file)
        return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, {
            day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
            timeZone: 'UTC',
        }).format(date)
    }
    const formatSize = value => {
        const bytes = Number(value)
        if (!Number.isFinite(bytes) || bytes < 0) return ''
        if (bytes < 1024) return `${bytes} B`
        const units = ['KB', 'MB', 'GB', 'TB']
        let size = bytes / 1024
        let unit = 0
        while (size >= 1024 && unit < units.length - 1) {
            size /= 1024
            unit++
        }
        return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
    }
    const groupDate = file => {
        const date = photoDate(file)
        if (Number.isNaN(date.getTime())) return 'Date unknown'
        return new Intl.DateTimeFormat(undefined, {
            month: 'long', year: 'numeric', ...(file.photo_taken_at ? { timeZone: 'UTC' } : {}),
        }).format(date)
    }
    const monthKey = file => {
        const date = photoDate(file)
        return Number.isNaN(date.getTime())
            ? '' : `${file.photo_taken_at ? date.getUTCFullYear() : date.getFullYear()}-${String(
                (file.photo_taken_at ? date.getUTCMonth() : date.getMonth()) + 1,
            ).padStart(2, '0')}`
    }
    const renderTimeline = files => {
        dateTimeline.replaceChildren()
        const dated = files.map(file => ({ file, date: photoDate(file) }))
            .filter(item => !Number.isNaN(item.date.getTime()))
        const months = state.months.length
            ? state.months
            : [...new Set(dated.map(item => monthKey(item.file)).filter(Boolean))]
                .map(month_key => ({ month_key, photo_count: 0 }))
        if (!dated.length && !months.length) {
            dateTimeline.hidden = true
            return
        }
        dated.sort((a, b) => new Date(a.file.photo_taken_at || a.file.uploaded_at)
            - new Date(b.file.photo_taken_at || b.file.uploaded_at))
        const formatRangeDate = item => new Intl.DateTimeFormat(undefined, {
            day: 'numeric', month: 'short', year: 'numeric',
            ...(item.file.photo_taken_at ? { timeZone: 'UTC' } : {}),
        }).format(item.date)
        const range = document.createElement('p')
        range.className = 'date-range'
        const first = dated[0]
        const last = dated.at(-1)
        if (months.length > 1) {
            const monthDate = key => new Date(`${key}-01T00:00:00Z`)
            const monthLabel = key => new Intl.DateTimeFormat(undefined, {
                month: 'long', year: 'numeric', timeZone: 'UTC',
            }).format(monthDate(key))
            range.textContent = `${monthLabel(months.at(-1).month_key)} – ${monthLabel(months[0].month_key)}`
        } else if (first && last) {
            const parts = ({ file, date }) => file.photo_taken_at
                ? [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]
                : [date.getFullYear(), date.getMonth(), date.getDate()]
            const sameDay = parts(first).every((part, index) => part === parts(last)[index])
            range.textContent = sameDay
                ? formatRangeDate(first) : `${formatRangeDate(first)} – ${formatRangeDate(last)}`
        }
        const places = [...new Set(files.map(locationLabel).filter(Boolean))]
        if (places.length === 1) {
            const place = document.createElement('p')
            place.className = 'date-location'
            place.textContent = `⌖ ${places[0]}`
            dateTimeline.append(place)
        }
        const navigation = document.createElement('nav')
        navigation.className = 'timeline-months'
        navigation.setAttribute('aria-label', 'Jump to month')
        for (const { month_key, photo_count } of months) {
            const key = month_key
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = new Intl.DateTimeFormat(undefined, {
                month: 'short', year: 'numeric', timeZone: 'UTC',
            }).format(new Date(`${key}-01T00:00:00Z`)) + (photo_count ? ` · ${photo_count}` : '')
            button.setAttribute('aria-pressed', state.month === key ? 'true' : 'false')
            button.addEventListener('click', async () => {
                state.month = state.month === key ? '' : key
                await searchLibrary(state.search)
            })
            navigation.append(button)
        }
        dateTimeline.prepend(range)
        dateTimeline.append(navigation)
        dateTimeline.hidden = false
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
    const matchingPhotoCount = () => state.month
        ? Number(state.months.find(item => item.month_key === state.month)?.photo_count || 0)
        : state.months.reduce((total, item) => total + Number(item.photo_count || 0), 0)
    const updateUserLoadMore = () => {
        const offset = state.view === 'recent' ? state.recentOffset : state.offset
        loadMore.hidden = offset >= matchingPhotoCount()
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
        appendMeta(viewerInfo, '◷', 'Taken', formatTakenDate(file))
        appendMeta(viewerInfo, '◉', 'Location', locationLabel(file))
        appendMeta(viewerInfo, '▤', 'Size', formatSize(file.size_bytes))
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
        const filtered = state.files.filter(file => /^image\/(jpeg|png|gif|webp|avif|heic|heif)$/i.test(file.type)
            || /^video\/(mp4|webm|ogg)$/i.test(file.type))
            .sort((a, b) => new Date(b.photo_taken_at || b.uploaded_at) - new Date(a.photo_taken_at || a.uploaded_at))
        state.photos = filtered
        renderTimeline(filtered)
        if (!filtered.length) {
            const empty = document.createElement('p')
            empty.className = 'muted'
            const emptyLabels = {
                recent: 'No recent uploads.', favorites: 'No favorites yet.',
                images: 'No images yet.', videos: 'No videos yet.',
            }
            empty.textContent = state.search ? 'No matching photos.'
                : state.activeAlbum ? 'This album is empty.' : emptyLabels[state.view] || 'No photos yet.'
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
            section.dataset.monthKey = monthKey(files[0])
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
                preview.src = fileUrl(file.id, !isVideo)
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
                if (!isPublic && file.owner === window.cdnAuthUser?.id) {
                    const favorite = document.createElement('button')
                    favorite.className = 'photo-favorite'
                    favorite.type = 'button'
                    favorite.textContent = file.is_favorite ? '♥' : '♡'
                    favorite.setAttribute(
                        'aria-label', file.is_favorite ? `Remove ${file.name} from favorites` : `Add ${file.name} to favorites`,
                    )
                    favorite.setAttribute('aria-pressed', file.is_favorite ? 'true' : 'false')
                    favorite.addEventListener('click', async event => {
                        event.stopPropagation()
                        const result = await api(`/api/files/${encodeURIComponent(file.id)}/favorite`, {
                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ favorite: !file.is_favorite }),
                        })
                        file.is_favorite = result.favorite
                        if (state.view === 'favorites' && !file.is_favorite) {
                            state.allFiles = state.allFiles.filter(item => item.id !== file.id)
                            state.files = state.allFiles
                            state.offset = Math.max(0, state.offset - 1)
                            state.months = await api(withSearch(
                                `/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}/timeline`,
                            ))
                            updateUserLoadMore()
                            renderFiles()
                        } else {
                            favorite.textContent = file.is_favorite ? '♥' : '♡'
                            favorite.setAttribute('aria-label', file.is_favorite
                                ? `Remove ${file.name} from favorites` : `Add ${file.name} to favorites`)
                            favorite.setAttribute('aria-pressed', file.is_favorite ? 'true' : 'false')
                        }
                    })
                    card.append(favorite)
                }
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
                            state.albumOffset = Math.max(0, state.albumOffset - 1)
                            state.activeAlbum.total = Math.max(0, state.activeAlbum.total - 1)
                            loadMore.hidden = state.albumOffset >= state.activeAlbum.total
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
        state.searchRequest++
        try {
            const album = await api(withFilters(`/api/albums/${encodeURIComponent(id)}?limit=100&offset=0`))
            state.activeAlbum = album
            state.months = album.timeline || []
            state.view = 'album'
            state.files = album.items
            state.albumOffset = album.items.length
            state.selected.clear()
            title.textContent = album.name
            manageButton.hidden = album.role !== 'owner'
            loadMore.hidden = album.items.length >= album.total
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
                title.textContent = 'Library'
                manageButton.hidden = true
                const [files, months] = await Promise.all([
                    api(withFilters(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?limit=100&offset=0`)),
                    api(withSearch(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}/timeline`)),
                ])
                state.allFiles = files
                state.files = files
                state.months = months
                state.offset = files.length
                updateUserLoadMore()
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
    document.querySelectorAll('.library-nav').forEach(button => button.addEventListener('click', async () => {
        state.searchRequest++
        state.view = button.dataset.view
        state.activeAlbum = null
        state.selected.clear()
        const viewTitles = {
            library: 'Library', recent: 'Recent', favorites: 'Favorites', images: 'Images', videos: 'Videos',
        }
        title.textContent = viewTitles[state.view] || 'Library'
        document.querySelectorAll('.library-nav').forEach(item => item.setAttribute('aria-current', item === button ? 'page' : 'false'))
        manageButton.hidden = true
        updateSelection()
        root.replaceChildren(Object.assign(document.createElement('span'), {
            className: 'loading-indicator',
        }))
        root.setAttribute('aria-busy', 'true')
        page.setAttribute('aria-busy', 'true')
        try {
            const recent = state.view === 'recent'
            const sort = recent ? 'sort=uploaded&' : ''
            const filesUrl = `/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?${sort}limit=100&offset=0`
            const [files, months] = await Promise.all([
                api(withFilters(filesUrl)),
                api(withSearch(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}/timeline`)),
            ])
            if (recent) {
                state.recentFiles = files
                state.recentOffset = files.length
            } else {
                state.allFiles = files
                state.offset = files.length
            }
            state.months = months
            state.files = files
            updateUserLoadMore()
            renderFiles()
        } catch (error) {
            showError(error.message)
        }
    }))
    let searchTimer
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer)
        const search = searchInput.value.trim().slice(0, 120)
        searchTimer = setTimeout(() => searchLibrary(search), 250)
    })

    async function searchLibrary(search) {
        state.search = search
        const request = ++state.searchRequest
        root.replaceChildren(Object.assign(document.createElement('span'), {
            className: 'loading-indicator',
        }))
        root.setAttribute('aria-busy', 'true')
        page.setAttribute('aria-busy', 'true')
        loadMore.hidden = true
        try {
            if (isPublic) {
                const album = await api(withFilters(`/api/albums/public/${encodeURIComponent(publicToken)}?limit=100&offset=0`))
                if (request !== state.searchRequest) return
                state.activeAlbum = album
                state.files = album.items
                state.albumOffset = album.items.length
                state.months = album.timeline || []
                loadMore.hidden = state.albumOffset >= album.total
            } else if (state.view === 'album' && state.activeAlbum) {
                const album = await api(withFilters(`/api/albums/${encodeURIComponent(state.activeAlbum.id)}?limit=100&offset=0`))
                if (request !== state.searchRequest) return
                state.activeAlbum = album
                state.files = album.items
                state.albumOffset = album.items.length
                state.months = album.timeline || []
                loadMore.hidden = state.albumOffset >= album.total
            } else if (state.view === 'recent') {
                const url = `/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?sort=uploaded&limit=100&offset=0`
                const [files, months] = await Promise.all([
                    api(withFilters(url)),
                    api(withSearch(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}/timeline`)),
                ])
                if (request !== state.searchRequest) return
                state.recentFiles = files
                state.files = files
                state.recentOffset = files.length
                state.months = months
                updateUserLoadMore()
            } else {
                const [files, months] = await Promise.all([
                    api(withFilters(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?limit=100&offset=0`)),
                    api(withSearch(`/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}/timeline`)),
                ])
                if (request !== state.searchRequest) return
                state.allFiles = files
                state.files = files
                state.offset = files.length
                state.months = months
                updateUserLoadMore()
            }
            if (request === state.searchRequest) renderFiles()
        } catch (error) {
            if (request === state.searchRequest) showError(error.message)
        }
    }
    loadMore?.addEventListener('click', () => loadMoreFiles().catch(error => { loadMore.textContent = error.message }))

    async function loadAlbums() {
        state.albums = await api('/api/albums')
        renderSidebar()
    }
    async function loadMoreFiles() {
        if (isPublic) {
            loadMore.disabled = true
            try {
                const url = `/api/albums/public/${encodeURIComponent(publicToken)}?limit=100&offset=${state.albumOffset}`
                const next = await api(withFilters(url))
                state.files.push(...next.items)
                state.albumOffset += next.items.length
                state.activeAlbum = next
                state.months = next.timeline || state.months
                loadMore.hidden = state.albumOffset >= next.total
                renderFiles()
            } finally { loadMore.disabled = false }
            return
        }
        if (!window.cdnAuthUser) return
        if (state.view === 'recent') {
            loadMore.disabled = true
            try {
                const next = await api(
                    withFilters(
                        `/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?sort=uploaded&limit=100&offset=${state.recentOffset}`,
                    ),
                )
                state.recentOffset += next.length
                state.recentFiles.push(...next)
                state.files = state.recentFiles
                updateUserLoadMore()
                renderFiles()
            } finally { loadMore.disabled = false }
            return
        }
        if (state.view === 'album' && state.activeAlbum) {
            loadMore.disabled = true
            try {
                const url = `/api/albums/${encodeURIComponent(state.activeAlbum.id)}?limit=100&offset=${state.albumOffset}`
                const next = await api(withFilters(url))
                state.files.push(...next.items)
                state.activeAlbum = { ...next, items: state.files }
                state.months = next.timeline || state.months
                state.albumOffset += next.items.length
                loadMore.hidden = state.albumOffset >= next.total
                renderFiles()
            } finally { loadMore.disabled = false }
            return
        }
        loadMore.disabled = true
        try {
            const url = `/api/files/user/${encodeURIComponent(window.cdnAuthUser.id)}?limit=100&offset=${state.offset}`
            const next = await api(withFilters(url))
            state.offset += next.length
            state.allFiles.push(...next)
            state.files = state.allFiles
            updateUserLoadMore()
            renderFiles()
        } finally { loadMore.disabled = false }
    }
    if (isPublic) {
        document.querySelector('.library-sidebar')?.remove()
        page.style.gridTemplateColumns = 'minmax(0,1fr)'
        Promise.all([api(withFilters(`/api/albums/public/${encodeURIComponent(publicToken)}?limit=100&offset=0`))]).then(([album]) => {
            title.textContent = album.name
            state.files = album.items
            state.months = album.timeline || []
            state.albumOffset = album.items.length
            state.activeAlbum = album
            loadMore.hidden = state.albumOffset >= album.total
            renderFiles()
        }).catch(error => showError(error.message))
    } else {
        window.cdnAuth.then(async auth => {
            if (!auth?.id) return location.replace('/login?returnTo=%2Fgallery')
            window.cdnAuthUser = auth
            const [, files, months] = await Promise.all([
                loadAlbums(),
                api(`/api/files/user/${encodeURIComponent(auth.id)}?limit=100&offset=0`),
                api(`/api/files/user/${encodeURIComponent(auth.id)}/timeline`),
            ])
            state.allFiles = files
            state.files = files
            state.months = months
            state.offset = files.length
            updateUserLoadMore()
            renderFiles()
        }).catch(error => showError(error.message || 'The photo library could not be loaded.'))
    }
})()
