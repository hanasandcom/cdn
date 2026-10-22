import ExifReader from 'exifreader'

type PhotoMetadata = {
    photoTakenAt: Date | null
    photoTakenOffsetMinutes: number | null
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

function coordinate(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'string' || value.length > 80) return null
    const normalized = value.trim().toUpperCase()
        .replace(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (_match, numerator: string, denominator: string) => {
            const divisor = Number(denominator)
            return divisor ? String(Number(numerator) / divisor) : ''
        })
    const direction = normalized.match(/[NSEW]/)?.[0]
    const parts = normalized.replace(/[NSEW]/g, '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || []
    if (parts.length < 1 || parts.length > 3 || parts.some(part => !Number.isFinite(part))) return null
    const sign = parts[0] < 0 || direction === 'S' || direction === 'W' ? -1 : 1
    const degrees = Math.abs(parts[0])
    const minutes = Math.abs(parts[1] || 0)
    const seconds = Math.abs(parts[2] || 0)
    if (minutes >= 60 || seconds >= 60) return null
    const result = sign * (degrees + minutes / 60 + seconds / 3600)
    return Number.isFinite(result) ? result : null
}

function parseDate(value: string, offset: string): { date: Date, offsetMinutes: number | null } | null {
    const raw = value.trim()
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[ T](\d{2})(\d{2})(\d{2}))?$/)
    const normalized = compact
        ? `${compact[1]}-${compact[2]}-${compact[3]}${compact[4] ? `T${compact[4]}:${compact[5]}:${compact[6]}` : ''}`
        : raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T')
    const zoneText = offset || normalized.match(/(?:Z|[+-]\d{2}:?\d{2})$/i)?.[0] || ''
    const zone = zoneText.match(/^([+-])(\d{2}):?(\d{2})$/)
    const zoneHours = Number(zone?.[2])
    const zoneRemainder = Number(zone?.[3])
    if (zone && (zoneHours > 14 || zoneRemainder > 59 || (zoneHours === 14 && zoneRemainder !== 0))) return null
    const offsetMinutes = zone
        ? (zone[1] === '-' ? -1 : 1) * (zoneHours * 60 + zoneRemainder)
        : zoneText.toUpperCase() === 'Z' ? 0 : null
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
    const candidate = zone && !hasZone ? `${normalized}${offset}` : normalized
    const plainDateTime = candidate.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/)
    const parsed = plainDateTime
        ? Date.UTC(
            Number(plainDateTime[1]), Number(plainDateTime[2]) - 1, Number(plainDateTime[3]),
            Number(plainDateTime[4]), Number(plainDateTime[5]), Number(plainDateTime[6]),
            Number((plainDateTime[7] || '0').padEnd(3, '0')),
        )
        : Date.parse(candidate)
    if (!Number.isFinite(parsed)) return null
    const date = new Date(parsed)
    return date.getUTCFullYear() >= 1800 && date.getUTCFullYear() <= new Date().getUTCFullYear() + 1
        ? { date, offsetMinutes }
        : null
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
    const empty = {
        photoTakenAt: null, photoTakenOffsetMinutes: null, locationLabel: null,
        latitude: null, longitude: null,
    }
    if (!/^image\/(jpeg|png|webp|avif|tiff|heic|heif)$/i.test(type)) return empty

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
        const takenOffset = firstTag([exif, xmp, pngText], [
            'OffsetTimeOriginal', 'OffsetTimeDigitized', 'OffsetTime',
        ])
        const parsedTaken = taken ? parseDate(taken, takenOffset) : null
        const gps = (tags.gps || {}) as { Latitude?: unknown, Longitude?: unknown }
        const latitude = coordinate(gps.Latitude)
            ?? coordinate(firstTag(groups, ['GPSLatitude', 'Latitude']))
        const longitude = coordinate(gps.Longitude)
            ?? coordinate(firstTag(groups, ['GPSLongitude', 'Longitude']))
        const validCoordinates = latitude !== null && longitude !== null
            && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
        const locationGroups = [iptc, xmp, exif, pngText]
        const locality = [
            firstTag(locationGroups, ['SubLocation', 'Sublocation', 'LocationName', 'Location']),
            firstTag(locationGroups, ['City']),
            firstTag(locationGroups, ['ProvinceState', 'State', 'Province']),
            firstTag(locationGroups, ['CountryPrimaryLocationName', 'CountryName', 'Country']),
        ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ')

        return {
            photoTakenAt: parsedTaken?.date || null,
            photoTakenOffsetMinutes: parsedTaken?.offsetMinutes ?? null,
            locationLabel: locality || null,
            latitude: validCoordinates ? latitude : null,
            longitude: validCoordinates ? longitude : null,
        }
    } catch {
        return empty
    }
}
