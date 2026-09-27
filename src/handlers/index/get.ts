import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getIndex(_req: FastifyRequest, res: FastifyReply) {
    return res.type('text/html').send(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Hanasand CDN</title>
<link rel="icon" type="image/png" href="https://hanasand.com/icon-192.png">
<style>
:root{color-scheme:dark;--bg:#050505;--panel:#0b0b0b;--line:#393939;--text:#f6f6f3;--muted:#a1a1a1;--accent:#780606}
*{box-sizing:border-box}
body{font:16px system-ui,-apple-system,sans-serif;background:radial-gradient(ellipse 34rem 24rem at 50% 10%,rgba(120,6,6,.08),transparent 76%),var(--bg);color:var(--text);display:grid;min-height:100vh;margin:0;place-items:center;padding:1rem}
main{max-width:36rem;padding:2rem;text-align:center;border:1px solid rgba(255,255,255,.12);border-radius:1.25rem;background:linear-gradient(180deg,#101010,var(--panel));box-shadow:0 24px 80px rgba(0,0,0,.4)}
main>img{display:block;margin:0 auto;object-fit:contain}
h1{font-size:2.5rem;letter-spacing:-.04em}
p{color:var(--muted);line-height:1.6}
.actions{display:flex;flex-wrap:wrap;justify-content:center;gap:.75rem;margin-top:1.5rem}
a{display:inline-block;padding:.8rem 1.2rem;border:1px solid var(--accent);border-radius:.6rem;color:var(--text);text-decoration:none;transition:background .18s ease,border-color .18s ease}
a:hover{background:#b13b30;border-color:#b13b30}
</style>
<main>
<img src="https://hanasand.com/hanasand-logo-transparent.png" alt="" width="72" height="72">
<h1>Hanasand CDN</h1>
<p>Upload files, browse your library, and share links.</p>
<div class="actions">
<a href="https://hanasand.com/gallery">Open library</a>
<a href="https://hanasand.com/upload">Upload a file</a>
</div>
</main>
</html>`)
}
