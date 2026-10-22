import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { FastifyReply, FastifyRequest } from 'fastify'

type AssetLoader = (specifier: 'hanasand/auth' | 'hanasand/auth.css') => Promise<string>

const CDN_LOGIN_SUBMIT_HANDLER = `
const cdnLoginForm = document.querySelector('#cdn-login-form');
const cdnLoginComponent = cdnLoginForm?.querySelector('hanasand-login-form');
cdnLoginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!cdnLoginComponent) return;
    cdnLoginComponent.setBusy(true);
    cdnLoginComponent.setError('');
    try {
        const values = new FormData(cdnLoginForm);
        const response = await fetch(cdnLoginForm.action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: values.get('username'), password: values.get('password') }),
            credentials: 'same-origin',
            cache: 'no-store',
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Sign-in failed. Please try again.');
        const redirectPath = cdnLoginComponent.getAttribute('redirect-path') || '/gallery';
        window.location.assign(redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/gallery');
    } catch (error) {
        cdnLoginComponent.setError(error instanceof Error ? error.message : 'Sign-in failed. Please try again.');
    } finally {
        cdnLoginComponent.setBusy(false);
    }
});
`

async function loadPackageAsset(specifier: 'hanasand/auth' | 'hanasand/auth.css') {
    return readFile(fileURLToPath(import.meta.resolve(specifier)), 'utf8')
}

export function createLoginAssetHandlers(load: AssetLoader = loadPackageAsset) {
    let script: Promise<string> | undefined
    let styles: Promise<string> | undefined

    return {
        async getScript(_req: FastifyRequest, res: FastifyReply) {
            try {
                script ??= load('hanasand/auth').then(source => `${source}\nregisterHanasandLoginForm();\n${CDN_LOGIN_SUBMIT_HANDLER}`)
                return res.header('Cache-Control', 'no-store')
                    .header('X-Content-Type-Options', 'nosniff')
                    .type('text/javascript; charset=utf-8')
                    .send(await script)
            } catch {
                script = undefined
                return res.header('Cache-Control', 'no-store')
                    .status(503)
                    .send({ error: 'Sign-in is temporarily unavailable.' })
            }
        },

        async getStyles(_req: FastifyRequest, res: FastifyReply) {
            try {
                styles ??= load('hanasand/auth.css')
                return res.header('Cache-Control', 'no-store')
                    .header('X-Content-Type-Options', 'nosniff')
                    .type('text/css; charset=utf-8')
                    .send(await styles)
            } catch {
                styles = undefined
                return res.header('Cache-Control', 'no-store')
                    .status(503)
                    .send({ error: 'Sign-in is temporarily unavailable.' })
            }
        },
    }
}

const assets = createLoginAssetHandlers()
export const getLoginFormScript = assets.getScript
export const getLoginFormStyles = assets.getStyles
