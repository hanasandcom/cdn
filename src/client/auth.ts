import { registerHanasandLoginForm } from 'hanasand/auth'
import 'hanasand/auth.css'

registerHanasandLoginForm()

document.addEventListener('submit', async event => {
    const form = event.target
    if (!(form instanceof HTMLFormElement)) return
    const loginForm = form.querySelector<HTMLElement & {
        setBusy?(busy: boolean): void
        setError?(message: string): void
    }>('hanasand-login-form')
    if (!loginForm || form.dataset.cdnLoginBound === 'true') return
    event.preventDefault()
    form.dataset.cdnLoginBound = 'true'

    const username = form.querySelector<HTMLInputElement>('input[name="username"]')?.value.trim() || ''
    const password = form.querySelector<HTMLInputElement>('input[name="password"]')?.value || ''
    const redirectPath = form.querySelector<HTMLInputElement>('input[name="redirectPath"]')?.value || '/gallery'
    loginForm.setError?.('')
    loginForm.setBusy?.(true)

    try {
        const response = await fetch(form.action, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        })
        const result = await response.json().catch(() => null) as { error?: string } | null
        if (!response.ok) throw new Error(result?.error || 'Sign-in failed. Please try again.')

        const target = new URL(redirectPath, window.location.origin)
        window.location.assign(target.origin === window.location.origin ? `${target.pathname}${target.search}${target.hash}` : '/gallery')
    } catch (error) {
        loginForm.setError?.(error instanceof Error ? error.message : 'Sign-in failed. Please try again.')
        loginForm.setBusy?.(false)
        delete form.dataset.cdnLoginBound
    }
})
