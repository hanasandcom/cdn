import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })
const hanasandEnv = dotenv.config({ path: path.resolve(__dirname, '../../hanasand/.env') })

const args = process.argv.slice(2)
const started = performance.now()
const apiBase = process.env.STATUS_API_BASE || process.env.API_URL || 'http://127.0.0.1:8080/api'
const token = process.env.STATUS_INGEST_TOKEN || hanasandEnv.parsed?.VM_API_TOKEN || process.env.VM_API_TOKEN || ''

function postStatus(status: 'up' | 'down', message: string): Promise<void> {
    if (!token) return Promise.resolve()

    return fetch(`${apiBase}/status/ingest`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({
            service: 'cdn',
            check_name: 'Playwright traffic',
            status,
            latency_ms: Math.round(performance.now() - started),
            message,
        }),
    })
        .then(async response => {
            if (!response.ok) {
                console.error(`Failed to publish CDN Playwright status: ${response.status} ${await response.text()}`)
            }
        })
        .catch(error => {
            console.error(`Failed to publish CDN Playwright status: ${error}`)
        })
}

const child = spawn('npx', ['playwright', 'test', ...args], {
    stdio: 'inherit',
    env: process.env,
})

const code = await new Promise<number | null>(resolve => {
    child.on('close', resolve)
})

const status = code === 0 ? 'up' : 'down'
const message = code === 0
    ? 'CDN Playwright traffic checks passed.'
    : `CDN Playwright traffic checks failed with exit code ${code}.`
await postStatus(status, message)
process.exit(code ?? 1)
