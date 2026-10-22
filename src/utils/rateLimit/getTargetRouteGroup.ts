import { TARGET_ROUTE_GROUPS } from './constants.ts'
import getPathname from './getPathname.ts'

export default function getTargetRouteGroup(url: string) {
    const path = getPathname(url)
    if (path === '/api/files/check') {
        return '/api/files/check'
    }
    if (path === '/api/auth/login-form.js' || path === '/api/auth/device-proof-client.js'
        || path === '/api/auth/device-proof' || path === '/api/auth/device-proof.js'
        || path === '/api/auth/device-proof/origins') {
        return path
    }

    for (const prefix of TARGET_ROUTE_GROUPS) {
        if (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix) {
            return prefix
        }
    }

    return null
}
