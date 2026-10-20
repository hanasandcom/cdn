const inlineTypes = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'video/mp4', 'video/webm', 'video/ogg',
])

export function fileResponseHeaders(name: string, declaredType: string) {
    const safeName = Array.from(name, char => {
        const code = char.charCodeAt(0)
        return code < 32 || code === 127 || '\\/";'.includes(char) ? '_' : char
    }).join('').slice(0, 180) || 'download'
    const encodedName = encodeURIComponent(safeName).replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    const type = inlineTypes.has(declaredType.toLowerCase()) ? declaredType.toLowerCase() : 'application/octet-stream'
    const disposition = type === 'application/octet-stream' ? 'attachment' : 'inline'
    return {
        'Content-Type': type,
        'Content-Disposition': `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
        'Content-Security-Policy': 'default-src \'none\'; sandbox',
        'X-Content-Type-Options': 'nosniff',
        'X-Download-Options': 'noopen',
        'Cache-Control': 'public, max-age=60',
    }
}
