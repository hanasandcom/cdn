import type { FastifyReply, FastifyRequest } from 'fastify'

export default async function getIndex(_req: FastifyRequest, res: FastifyReply) {
    return res.type('text/html').send(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Hanasand CDN</title>
<style>
:root { color-scheme: dark; --bg: #070707; --panel: #101010; --line: #383838; }
* { box-sizing: border-box; }
body {
    font: 16px system-ui, -apple-system, sans-serif;
    background: radial-gradient(ellipse 34rem 24rem at 50% 10%, rgba(255,255,255,.035), transparent 76%), var(--bg);
    color: #f6f6f3; display: grid; min-height: 100vh; margin: 0; place-items: center; padding: 1rem;
}
main {
    max-width: 36rem; padding: 2rem; text-align: center; border: 1px solid rgba(255,255,255,.10);
    border-radius: 1.25rem; background: linear-gradient(180deg, #101010, var(--panel));
    box-shadow: 0 24px 80px rgba(0,0,0,.4);
}
h1 { font-size: 2.5rem; letter-spacing: -.04em; }
p { color: #999; line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: .75rem; margin-top: 1.5rem; }
a {
    display: inline-flex; align-items: center; justify-content: center; min-height: 2.75rem;
    padding: .7rem 1rem; border: 1px solid var(--line); border-radius: .6rem;
    background: #f6f6f3; color: #111; text-decoration: none; font-weight: 600;
    transition: opacity .18s ease, transform .18s ease;
}
a:hover { opacity: .88; transform: translateY(-1px); }
a:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
</style>
<main>
<h1>Hanasand CDN</h1>
<p>Upload files, browse your library, and share links.</p>
<div class="actions">
<a href="/gallery">Open library</a>
<a href="/upload">Upload a file</a>
</div>
</main>
</html>`)
}
