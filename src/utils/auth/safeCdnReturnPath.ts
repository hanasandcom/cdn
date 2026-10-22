export function safeCdnReturnPath(value: unknown) {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')
        || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
        return '/gallery'
    }
    try {
        const url = new URL(value, 'https://cdn.hanasand.com')
        return url.origin === 'https://cdn.hanasand.com' && !url.username && !url.password
            ? `${url.pathname}${url.search}`
            : '/gallery'
    } catch {
        return '/gallery'
    }
}
