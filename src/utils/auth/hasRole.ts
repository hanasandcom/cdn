import config from '#constants'

export default async function hasRole({ id, role, token }: { id: string, role: string, token?: string }): Promise<boolean> {
    try {
        const response = await fetch(`${config.auth_api}/roles/user/${encodeURIComponent(id)}`, {
            headers: token
                ? {
                    Authorization: `Bearer ${token}`,
                    id,
                }
                : undefined,
        })
        if (!response.ok) {
            throw new Error(await response.text())
        }

        const data = await response.json()
        if (!Array.isArray(data)) {
            return false
        }

        return data.some((item) => item?.role_id === role || item?.id === role)
    } catch (error) {
        console.log(error)
        return false
    }
}
