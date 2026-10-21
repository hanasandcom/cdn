/* global window, document, HTMLElement, customElements, TextDecoder, CustomEvent, DataTransfer, URL */
/* eslint-disable @stylistic/max-len */
(() => {
    if (customElements.get('hanasand-upload-picker')) return

    const filesPerPage = 25
    const normalizeKey = value => value.toLowerCase().replace(/[^a-z0-9]/g, '')
    const valueOf = value => value && typeof value === 'object' && 'value' in value ? value.value : value
    const metadataEntries = group => {
        const entries = []
        const seen = new WeakSet()
        const visit = (value, name = '', depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return
            seen.add(value)
            for (const [key, item] of Object.entries(value)) {
                if (key === '_raw' || key === 'metadataRange' || key === 'Thumbnail') continue
                if (item && typeof item === 'object' && !Array.isArray(item) && 'value' in item) {
                    const tagValue = valueOf(item)
                    entries.push({ name: key, path: name + key, value: tagValue })
                    if (tagValue && typeof tagValue === 'object') visit(tagValue, name + key, depth + 1)
                } else if (Array.isArray(item) || item && typeof item === 'object') {
                    visit(item, name + key, depth + 1)
                } else {
                    entries.push({ name: key, path: name + key, value: item })
                }
            }
        }
        visit(group)
        return entries
    }
    const metadataText = value => {
        value = valueOf(value)
        if (typeof value === 'string') return value.trim()
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
        if (Array.isArray(value) && value.length) {
            if (value.every(item => Number.isInteger(item) && item >= 0 && item <= 255)) {
                return new TextDecoder().decode(new Uint8Array(value)).replace(/\0+$/g, '').trim()
            }
            for (const item of value) {
                const text = metadataText(item)
                if (text) return text
            }
        }
        return ''
    }
    const displayDate = (date, includeTime = true) => {
        const day = String(date.getDate()).padStart(2, '0')
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const year = String(date.getFullYear()).slice(-2)
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        return `${day}.${month}.${year}${includeTime ? ` ${hours}:${minutes}` : ''}`
    }
    const readableDate = value => {
        const raw = metadataText(value)
        if (!raw) return null
        const match = raw.match(/^(\d{4})[:/-]?(\d{2})[:/-]?(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?)?$/)
        if (match) {
            const [, year, month, day, hour, minute, second, , zone] = match
            const date = zone
                ? new Date(Date.parse(`${year}-${month}-${day}T${hour || '00'}:${minute || '00'}:${second || '00'}${zone}`))
                : new Date(Number(year), Number(month) - 1, Number(day), Number(hour || 0), Number(minute || 0), Number(second || 0))
            return Number.isFinite(date.getTime()) ? displayDate(date, hour !== undefined) : null
        }
        const parsed = Date.parse(raw)
        if (!Number.isFinite(parsed)) return null
        return displayDate(new Date(parsed))
    }
    const dateFromTags = tags => {
        const groups = [
            ['Taken', tags.exif, ['datetimeoriginal', 'dateTimeOriginal']],
            ['Taken', tags.xmp, ['datetimeoriginal', 'datecreated', 'createdate', 'creationdate']],
            ['Taken', tags.iptc, ['datecreated']],
            ['Taken', tags.pngText, ['datetimeoriginal', 'datecreated', 'createdate', 'creationtime', 'timestamp']],
            ['Digitized', tags.exif, ['datetimedigitized']],
            ['Digitized', tags.xmp, ['createdate', 'digitalcreationdate']],
            ['Image date', tags.exif, ['datetime']],
        ]
        for (const [label, group, keys] of groups) {
            const wanted = keys.map(normalizeKey)
            for (const entry of metadataEntries(group)) {
                const key = normalizeKey(entry.path)
                if (!wanted.some(candidate => key === candidate || key.endsWith(candidate))) continue
                const date = readableDate(entry.value)
                if (date) return { label, value: date }
            }
        }
        return null
    }
    const locationFromTags = tags => {
        const locationGroups = [tags.iptc, tags.xmp, tags.exif, tags.pngText]
        const preferred = ['sublocation', 'city', 'province/state', 'state', 'country/primary location name', 'countryname', 'locationname', 'location']
        const names = []
        for (const key of preferred) {
            const wanted = normalizeKey(key)
            for (const group of locationGroups) {
                for (const entry of metadataEntries(group)) {
                    if (normalizeKey(entry.name) !== wanted) continue
                    const value = metadataText(entry.value)
                    if (value && !names.includes(value)) names.push(value)
                }
            }
        }
        const gps = tags.gps || {}
        const rational = value => {
            if (typeof value === 'number' && Number.isFinite(value)) return value
            if (value && typeof value === 'object' && 'numerator' in value && 'denominator' in value) {
                const denominator = Number(value.denominator)
                return denominator ? Number(value.numerator) / denominator : null
            }
            if (Array.isArray(value) && value.length === 2) {
                const denominator = Number(value[1])
                return denominator ? Number(value[0]) / denominator : null
            }
            return null
        }
        const coordinateValue = (value, reference) => {
            value = valueOf(value)
            let result = rational(value)
            if (result === null && Array.isArray(value)) {
                let parts = value.map(rational)
                if (parts.length === 6 && parts.every(Number.isFinite)) parts = [parts[0] / parts[1], parts[2] / parts[3], parts[4] / parts[5]]
                if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
                    result = Math.abs(parts[0]) + Math.abs(parts[1]) / 60 + Math.abs(parts[2]) / 3600
                } else if (parts.length === 1) result = parts[0]
            }
            if (result === null && value && typeof value === 'object') {
                if ('computed' in value) result = coordinateValue(value.computed, reference)
                else if ('value' in value) result = coordinateValue(value.value, reference)
            }
            if (result === null) {
                const raw = metadataText(value)
                const numbers = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
                if (numbers.length >= 3) result = Math.abs(numbers[0]) + Math.abs(numbers[1]) / 60 + Math.abs(numbers[2]) / 3600
                else if (numbers.length) result = numbers[0]
            }
            if (!Number.isFinite(result)) return null
            const referenceText = metadataText(reference).toUpperCase()
            const valueText = metadataText(value).toUpperCase()
            const direction = referenceText || (/\b[NSWE]\s*$/.test(valueText) ? valueText.slice(-1) : '')
            return /[SW]/.test(direction) ? -Math.abs(result) : /[NE]/.test(direction) ? Math.abs(result) : result
        }
        const coordinate = (latitude, longitude) => {
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
            return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
        }
        let latitude = coordinateValue(gps.Latitude)
        let longitude = coordinateValue(gps.Longitude)
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            const entries = [...metadataEntries(tags.exif), ...metadataEntries(tags.xmp), ...metadataEntries(tags.iptc), ...metadataEntries(tags.pngText)]
            const find = names => entries.find(entry => names.includes(normalizeKey(entry.name)))
            const lat = find(['gpslatitude', 'latitude'])
            const lon = find(['gpslongitude', 'longitude'])
            const latRef = find(['gpslatituderef', 'latituderef'])
            const lonRef = find(['gpslongituderef', 'longituderef'])
            latitude = coordinateValue(lat?.value, latRef?.value)
            longitude = coordinateValue(lon?.value, lonRef?.value)
        }
        const coordinates = coordinate(latitude, longitude)
        if (names.length && coordinates) return `${names.join(', ')} · ${coordinates}`
        if (names.length) return names.join(', ')
        return coordinates
    }
    const readMetadata = async file => {
        try {
            const reader = window.ExifReader
            if (!reader?.load) return { date: null, location: null }
            let tags
            try {
                tags = await reader.load(file, {
                    expanded: true,
                    includeOffsets: true,
                    length: 'auto',
                    excludeTags: { mpf: true },
                })
            } catch {
                tags = await reader.load(file, { expanded: true, excludeTags: { mpf: true } })
            }
            return { date: dateFromTags(tags), location: locationFromTags(tags) }
        } catch {
            return { date: null, location: null }
        }
    }

    class HanasandUploadPicker extends HTMLElement {
        static observedAttributes = ['multiple', 'disabled']
        selectedFiles = []
        page = 0
        objectUrls = []

        connectedCallback() {
            if (this.shadowRoot) return
            const shadow = this.attachShadow({ mode: 'open' })
            shadow.innerHTML = `
                <style>
                    :host { display: block; color: var(--ui-text, #f6f6f3); font: inherit; }
                    * { box-sizing: border-box; }
                    [hidden] { display: none !important; }
                    button, input { font: inherit; }
                    .panel { display: grid; overflow: hidden; grid-template-columns: minmax(0, 1fr); border: 1px solid var(--ui-border, #393939); border-radius: .75rem; background: var(--ui-panel, #101010); box-shadow: 0 8px 24px #0005; }
                    .drop-side { display: grid; min-height: 11rem; place-items: center; border-bottom: 1px solid var(--ui-border, #393939); background: var(--ui-raised, #191919); padding: .75rem; }
                    .dropzone { display: grid; width: 100%; min-height: 9rem; place-content: center; justify-items: center; gap: 1rem; border: 1px dashed var(--ui-border, #393939); border-radius: .75rem; background: var(--ui-panel, #101010); padding: 1.25rem; text-align: center; cursor: pointer; transition: border-color .15s, background .15s; }
                    .dropzone:hover, .dropzone.dragging, .dropzone:focus-visible { border-color: var(--ui-primary, #f6f6f3); background: color-mix(in srgb, var(--ui-primary, #f6f6f3) 8%, var(--ui-panel, #101010)); outline: none; }
                    .drop-icon { display: grid; width: 3rem; height: 3rem; place-items: center; border: 1px solid var(--ui-border, #393939); border-radius: .65rem; color: var(--ui-primary, #f6f6f3); font-size: 1.5rem; }
                    .drop-title { color: var(--ui-text, #f6f6f3); font-size: .875rem; font-weight: 650; }
                    .muted { color: var(--ui-muted, #aaa); font-size: .8rem; }
                    .upload-side { display: grid; min-width: 0; align-content: start; gap: 1rem; padding: 1.25rem; }
                    .description { margin: 0; color: var(--ui-muted, #aaa); font-size: .875rem; line-height: 1.5; }
                    .browse-button, .camera-button, .review-button, .pager button, .remove-button { display: inline-flex; min-height: 2.75rem; align-items: center; justify-content: center; border: 1px solid var(--ui-border, #393939); border-radius: .6rem; background: var(--ui-text, #f6f6f3); color: var(--ui-canvas, #111); padding: .7rem .85rem; font-size: .875rem; font-weight: 650; text-align: center; cursor: pointer; }
                    .browse-button { position: relative; width: 100%; overflow: hidden; border-color: transparent; }
                    .camera-button, .pager button, .remove-button { background: var(--ui-raised, #202020); color: var(--ui-text, #f6f6f3); }
                    .camera-button:hover, .pager button:not(:disabled):hover, .remove-button:hover { border-color: var(--ui-primary, #f6f6f3); }
                    .review-button { width: 100%; border-color: var(--ui-primary, #f6f6f3); background: var(--ui-primary, #f6f6f3); color: var(--ui-on-primary, #111); }
                    .browse-button:hover, .review-button:hover { opacity: .9; }
                    :host([disabled]) .browse-button, :host([disabled]) .dropzone { cursor: default; }
                    .browse-button input, .camera-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
                    .camera-button { width: 100%; }
                    .camera-wrap { position: relative; }
                    .file-list { display: grid; max-height: 20rem; gap: .5rem; overflow: auto; margin: 0; padding: 0; list-style: none; }
                    .list-heading { display: flex; align-items: center; justify-content: space-between; gap: .5rem; color: var(--ui-muted, #aaa); font-size: .75rem; }
                    .pager { display: flex; align-items: center; gap: .35rem; }
                    .pager button { min-height: 2rem; padding: .3rem .45rem; font-size: .7rem; }
                    .pager button:disabled { cursor: default; opacity: .5; }
                    .item { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; align-items: center; gap: .65rem; padding: .5rem; border: 1px solid var(--ui-border, #393939); border-radius: .6rem; background: var(--ui-canvas, #080808); }
                    .thumb { width: 3.5rem; height: 3.5rem; border-radius: .4rem; object-fit: cover; background: var(--ui-raised, #161616); }
                    .name { overflow-wrap: anywhere; margin: 0; color: var(--ui-text, #f6f6f3); font-size: .875rem; font-weight: 600; }
                    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: .3rem .75rem; overflow-wrap: anywhere; margin: .2rem 0 0; color: var(--ui-muted, #aaa); font-size: .7rem; line-height: 1.45; }
                    .metadata-item { display: inline-flex; min-width: 0; align-items: center; gap: .25rem; }
                    .metadata-item svg { width: .9rem; height: .9rem; flex: none; stroke: currentColor; stroke-width: 1.75; fill: none; stroke-linecap: round; stroke-linejoin: round; }
                    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
                    .remove-button { min-height: 2rem; padding: .4rem .55rem; font-size: .75rem; }
                    .empty { margin: 0; color: var(--ui-muted, #aaa); font-size: .875rem; }
                    .extras, .actions { display: grid; gap: .75rem; }
                    @media (min-width: 48rem) { .panel { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); } .drop-side { min-height: 26.25rem; border-right: 1px solid var(--ui-border, #393939); border-bottom: 0; padding: 1.5rem; } .dropzone { min-height: 21rem; padding: 2rem; } .upload-side { gap: 1.25rem; padding: 1.5rem; } }
                </style>
                <div class="panel">
                    <div class="drop-side"><div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="Drop files here or browse files"><span class="drop-icon" aria-hidden="true">↑</span><strong class="drop-title">Drop files here</strong><span class="muted">or choose files from the other panel</span></div></div>
                    <div class="upload-side">
                        <p class="description"></p>
                        <label class="browse-button">Browse files<input id="file" type="file" aria-label="Browse files"></label>
                        <div class="camera-wrap" hidden><label class="camera-button">Use camera<input class="camera-input" id="camera" type="file" capture="environment" aria-label="Use camera"></label></div>
                        <div class="extras"><slot name="extras"></slot></div>
                        <ul class="file-list" aria-live="polite" aria-label="Selected files"></ul>
                        <div class="list-heading"><span id="count"></span><nav class="pager" aria-label="Selected file pages"><button id="previous" type="button" disabled>Previous</button><span id="page"></span><button id="next" type="button" disabled>Next</button></nav></div>
                        <button class="review-button" id="review" type="button" hidden>Review file</button>
                        <div class="actions"><slot name="actions"></slot></div>
                    </div>
                </div>`
            this.input = shadow.querySelector('#file')
            this.cameraInput = shadow.querySelector('#camera')
            this.list = shadow.querySelector('.file-list')
            this.count = shadow.querySelector('#count')
            this.pageLabel = shadow.querySelector('#page')
            this.pager = shadow.querySelector('.pager')
            this.dropzone = shadow.querySelector('#dropzone')
            this.reviewButton = shadow.querySelector('#review')
            this.input.multiple = this.hasAttribute('multiple')
            this.attributeChangedCallback('disabled')
            shadow.querySelector('.description').textContent = this.getAttribute('description') || 'Choose files to upload, or drag them into the drop area.'
            shadow.querySelector('.camera-wrap').hidden = !this.hasAttribute('camera')
            this.input.addEventListener('change', () => this.addFiles(this.input.files))
            this.cameraInput.addEventListener('change', () => this.addFiles(this.cameraInput.files))
            this.dropzone.addEventListener('click', () => { if (!this.input.disabled) this.input.click() })
            this.dropzone.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!this.input.disabled) this.input.click() }
            })
            this.dropzone.addEventListener('dragover', event => { event.preventDefault(); this.dropzone.classList.add('dragging') })
            this.dropzone.addEventListener('dragleave', event => {
                if (!this.dropzone.contains(event.relatedTarget)) this.dropzone.classList.remove('dragging')
            })
            this.dropzone.addEventListener('drop', event => {
                event.preventDefault()
                this.dropzone.classList.remove('dragging')
                this.addFiles(event.dataTransfer.files)
            })
            shadow.querySelector('#previous').addEventListener('click', () => { this.page--; this.render() })
            shadow.querySelector('#next').addEventListener('click', () => { this.page++; this.render() })
            this.reviewButton.addEventListener('click', () => {
                if (this.selectedFiles.length) this.dispatchEvent(new CustomEvent('review', { detail: { file: this.selectedFiles[0] } }))
            })
            this.render()
        }

        attributeChangedCallback(name) {
            if (!this.input) return
            if (name === 'multiple') this.input.multiple = this.hasAttribute('multiple')
            if (name === 'disabled') {
                const disabled = this.hasAttribute('disabled')
                this.input.disabled = disabled
                this.cameraInput.disabled = disabled
                this.dropzone.tabIndex = disabled ? -1 : 0
                this.dropzone.setAttribute('aria-disabled', String(disabled))
            }
        }

        get files() { return this.selectedFiles.slice() }

        clear() {
            this.selectedFiles = []
            this.page = 0
            this.syncInput()
        }

        addFiles(fileList) {
            if (this.input.disabled) return
            const incoming = Array.from(fileList || [])
            if (!incoming.length) return
            this.input.value = ''
            this.selectedFiles = this.input.multiple ? this.selectedFiles.concat(incoming) : incoming.slice(0, 1)
            this.page = 0
            this.syncInput()
            this.dispatchEvent(new CustomEvent('fileschange', { detail: { files: this.files }, bubbles: true }))
        }

        removeFile(index) {
            this.selectedFiles = this.selectedFiles.filter((_, fileIndex) => fileIndex !== index)
            this.syncInput()
            this.dispatchEvent(new CustomEvent('fileschange', { detail: { files: this.files }, bubbles: true }))
        }

        syncInput() {
            const transfer = new DataTransfer()
            for (const file of this.selectedFiles) transfer.items.add(file)
            this.input.files = transfer.files
            this.render()
        }

        render() {
            for (const url of this.objectUrls) URL.revokeObjectURL(url)
            this.objectUrls = []
            this.list.replaceChildren()
            this.page = Math.max(0, Math.min(this.page, Math.ceil(this.selectedFiles.length / filesPerPage) - 1))
            const pageCount = Math.ceil(this.selectedFiles.length / filesPerPage)
            this.count.textContent = `${this.selectedFiles.length} file${this.selectedFiles.length === 1 ? '' : 's'}`
            this.count.hidden = this.selectedFiles.length === 0
            this.pager.hidden = pageCount <= 1
            this.pageLabel.textContent = `${this.selectedFiles.length ? this.page + 1 : 0} / ${pageCount}`
            this.shadowRoot.querySelector('#previous').disabled = this.page === 0
            this.shadowRoot.querySelector('#next').disabled = this.page >= pageCount - 1
            this.reviewButton.hidden = !this.hasAttribute('review-button') || this.selectedFiles.length === 0
            if (!this.selectedFiles.length) {
                const empty = document.createElement('li')
                empty.className = 'empty'
                empty.textContent = 'No files selected'
                this.list.append(empty)
                return
            }
            const start = this.page * filesPerPage
            this.selectedFiles.slice(start, start + filesPerPage).forEach((file, index) => {
                const row = document.createElement('li')
                const image = document.createElement('img')
                const details = document.createElement('div')
                const name = document.createElement('p')
                const meta = document.createElement('p')
                const remove = document.createElement('button')
                const previewable = /^image\/(jpeg|png|gif|webp|avif|heic|heif|tiff?)$/i.test(file.type)
                row.className = 'item'
                image.className = 'thumb'
                image.alt = /^image\//i.test(file.type) ? '' : 'File'
                image.src = previewable ? URL.createObjectURL(file) : 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#161616"/><text x="28" y="36" text-anchor="middle" fill="#aaa" font-size="28">▤</text></svg>')
                if (image.src.startsWith('blob:')) this.objectUrls.push(image.src)
                name.className = 'name'
                name.textContent = file.name
                meta.className = 'meta'
                meta.replaceChildren(this.metadataItem('size', 'File size', formatBytes(file.size)))
                remove.className = 'remove-button'
                remove.type = 'button'
                remove.textContent = 'Remove'
                remove.setAttribute('aria-label', `Remove ${file.name}`)
                remove.addEventListener('click', () => this.removeFile(start + index))
                details.append(name, meta)
                row.append(image, details, remove)
                this.list.append(row)
                readMetadata(file).then(({ date, location }) => {
                    if (!row.isConnected) return
                    const modified = file.lastModified ? new Date(file.lastModified) : null
                    meta.replaceChildren(this.metadataItem('size', 'File size', formatBytes(file.size)))
                    if (date) meta.append(this.metadataItem('time', date.label, date.value))
                    else if (modified && Number.isFinite(modified.getTime())) meta.append(this.metadataItem('time', 'File modified', displayDate(modified)))
                    if (location) meta.append(this.metadataItem('location', 'Location', location))
                })
            })
        }

        metadataItem(iconName, label, value) {
            const paths = {
                size: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
                time: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
                location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
            }
            const item = document.createElement('span')
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
            const accessibleLabel = document.createElement('span')
            const text = document.createElement('span')
            item.className = 'metadata-item'
            icon.setAttribute('viewBox', '0 0 24 24')
            icon.setAttribute('aria-hidden', 'true')
            icon.innerHTML = paths[iconName]
            accessibleLabel.className = 'sr-only'
            accessibleLabel.textContent = `${label}: `
            text.textContent = value
            item.append(icon, accessibleLabel, text)
            return item
        }
    }

    const formatBytes = bytes => {
        if (bytes < 1024) return `${bytes} B`
        const units = ['KB', 'MB', 'GB']
        let size = bytes / 1024
        let unit = 0
        while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++ }
        return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`
    }

    customElements.define('hanasand-upload-picker', HanasandUploadPicker)
})()
