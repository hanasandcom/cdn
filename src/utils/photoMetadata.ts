import ExifReader from 'exifreader'

type PhotoMetadata = {
    photoTakenAt: Date | null
    locationLabel: string | null
    latitude: number | null
    longitude: number | null
}

type Tag = { description?: string, value?: unknown }

function text(tag: Tag | undefined): string {
    if (!tag) return ''
    const value = tag.description ?? tag.value
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (Array.isArray(value)) return value.map(item => typeof item === 'number' ? String(item) : '').join('').trim()
    return ''
}

function parseDate(value: string): Date | null {
    const raw = value.trim()
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[ T](\d{2})(\d{2})(\d{2}))?$/)
    const normalized = compact
        ? `${compact[1]}-${compact[2]}-${compact[3]}${compact[4] ? `T${compact[4]}:${compact[5]}:${compact[6]}Z` : ''}`
        : raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    const parsed = Date.parse(normalized)
    if (!Number.isFinite(parsed)) return null
    const date = new Date(parsed)
    return date.getUTCFullYear() >= 1800 && date.getUTCFullYear() <= new Date().getUTCFullYear() + 1 ? date : null
}

function firstTag(groups: Record<string, unknown>[], keys: string[]): string {
    const wanted = keys.map(key => key.toLowerCase().replace(/[^a-z0-9]/g, ''))
    for (const group of groups) {
        const visited = new WeakSet<object>()
        let visitedEntries = 0
        const find = (value: unknown, depth: number): string => {
            if (!value || typeof value !== 'object' || depth > 8 || visited.has(value)) return ''
            visited.add(value)
            for (const [key, item] of Object.entries(value)) {
                if (++visitedEntries > 2000 || ['_raw', 'thumbnail', 'metadataRange'].includes(key)) return ''
                const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
                if (wanted.some(candidate => normalized === candidate || normalized.endsWith(candidate))) {
                    const found = text(item as Tag).slice(0, 250)
                    if (found) return found
                }
                const nested = find(item, depth + 1)
                if (nested) return nested
            }
            return ''
        }
        const found = find(group, 0)
        if (found) return found
    }
    return ''
}

export function readPhotoMetadata(data: Buffer, type: string): PhotoMetadata {
    const empty = { photoTakenAt: null, locationLabel: null, latitude: null, longitude: null }
    if (!/^image\/(jpeg|png|webp|avif|tiff|heic|heif)$/i.test(type)) return empty
    if (data.length > 8 * 1024 * 1024) data = data.subarray(0, 8 * 1024 * 1024)

    try {
        const tags = ExifReader.load(data, { expanded: true, computed: true, excludeTags: { mpf: true } }) as Record<string, unknown>
        const exif = (tags.exif || {}) as Record<string, unknown>
        const xmp = (tags.xmp || {}) as Record<string, unknown>
        const iptc = (tags.iptc || {}) as Record<string, unknown>
        const pngText = (tags.pngText || {}) as Record<string, unknown>
        const groups = [exif, xmp, iptc, pngText]
        const taken = firstTag(groups, [
            'DateTimeOriginal', 'DateCreated', 'CreateDate', 'CreationDate',
            'CreationTime', 'Timestamp', 'DateTimeDigitized', 'DateTime',
        ])
        const latitude = Number((tags.gps as { Latitude?: unknown } | undefined)?.Latitude)
        const longitude = Number((tags.gps as { Longitude?: unknown } | undefined)?.Longitude)
        const validCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude)
            && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        const locality = [
            firstTag([iptc, xmp], ['SubLocation', 'Sublocation', 'LocationName', 'Location']),
            firstTag([iptc, xmp], ['City']),
            firstTag([iptc, xmp], ['ProvinceState', 'State', 'Province']),
            firstTag([iptc, xmp], ['CountryPrimaryLocationName', 'CountryName', 'Country']),
        ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ')

        return {
            photoTakenAt: taken ? parseDate(taken) : null,
            locationLabel: locality || null,
            latitude: validCoordinates ? latitude : null,
            longitude: validCoordinates ? longitude : null,
        }
    } catch {
        return empty
    }
}
