import type { FastifyReply, FastifyRequest } from 'fastify'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Header } from 'hanasand'
import { renderHanasandLoginFormMarkup } from 'hanasand/auth'
import { getSessionDetails, setSessionCookies } from '#utils/auth/session.ts'
import { safeCdnReturnPath } from '#utils/auth/safeCdnReturnPath.ts'

const uploadPickerPath = new URL('../../client/upload-picker.js', import.meta.url)
const bulkUploadPath = new URL('../../client/bulk-upload.js', import.meta.url)
const galleryClientPath = new URL('../../client/gallery.js', import.meta.url)
const exifReaderPath = new URL('../../../node_modules/exifreader/dist/exif-reader.js', import.meta.url)
const authClientScriptPath = new URL('../../../dist/client/auth.js', import.meta.url)
const authClientStylesheetPath = new URL('../../../dist/client/auth.css', import.meta.url)
const hanasandChromeStylesheetPath = new URL(import.meta.resolve('hanasand/chrome.css'))
const hanasandLogoPath = new URL('./assets/hanasand-logo.png', import.meta.resolve('hanasand'))
export async function getUploadPickerScript(_req: FastifyRequest, res: FastifyReply) {
    const script = await readFile(uploadPickerPath)
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(script)
}

export async function getBulkUploadScript(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(await readFile(bulkUploadPath))
}

export async function getExifReaderScript(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(await readFile(exifReaderPath))
}

export async function getGalleryClientScript(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(await readFile(galleryClientPath))
}

export async function getAuthClientScript(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/javascript').send(await readFile(authClientScriptPath))
}

export async function getAuthClientStylesheet(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'no-store').type('text/css').send(await readFile(authClientStylesheetPath))
}

export async function getHanasandChromeStylesheet(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'public, max-age=86400').type('text/css').send(await readFile(hanasandChromeStylesheetPath))
}

export async function getHanasandLogo(_req: FastifyRequest, res: FastifyReply) {
    return res.header('Cache-Control', 'public, max-age=86400').type('image/png').send(await readFile(hanasandLogoPath))
}

const styles = `
:root { color-scheme: dark; font: 16px system-ui, sans-serif; background: #070707; color: #f6f6f3; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; padding: 2rem 1rem; display: grid; place-items: center; }
main { width: min(100%, 58rem); padding: 2rem; border: 1px solid #383838; border-radius: 1rem; background: #101010; }
main.login-page { width: min(100%, 42rem); max-width: 42rem; padding: 2rem; border-radius: 1rem; box-shadow: 0 1.5rem 3rem #0003; }
body.gallery-body { display: block; padding: 0; background: #070707; }
main.gallery-page {
    width: 100%; max-width: none; min-height: 100vh; padding: 0; border: 0;
    border-radius: 0; background: #070707;
}
main.gallery-page > h1 { display: none; }
a { color: inherit; }
header { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.hanasand-header.cdn-header { width: 100%; margin-bottom: 1.5rem; }
.hanasand-header.cdn-header .hanasand-header__links { display: none; }
.cdn-header-actions { display: flex; min-width: 0; align-items: center; gap: .5rem; margin-left: auto; }
.cdn-header--hide-brand .hanasand-header__brand { display: none; }
main.login-page header { flex-wrap: wrap; }
h1 { font-size: 2rem; margin: .5rem 0; }
p { color: #999; line-height: 1.5; }
input, button { font: inherit; border-radius: .6rem; padding: .75rem; }
input {
    appearance: none; width: 100%; background: #080808; color: #f6f6f3;
    border: 1px solid #383838; caret-color: #f6f6f3;
}
input:focus, input:focus-visible {
    background-color: #080808; color: #f6f6f3; border-color: #707070;
}
input::selection { background: #292929; color: #f6f6f3; }
input:-webkit-autofill {
    -webkit-text-fill-color: #f6f6f3; caret-color: #f6f6f3;
    -webkit-box-shadow: 0 0 0 1000px #080808 inset; box-shadow: 0 0 0 1000px #080808 inset;
}
input:autofill {
    -webkit-text-fill-color: #f6f6f3; caret-color: #f6f6f3;
    -webkit-box-shadow: 0 0 0 1000px #080808 inset; box-shadow: 0 0 0 1000px #080808 inset;
}
button { border: 0; background: #f6f6f3; color: #111; font-weight: 600; cursor: pointer; }
button:disabled { cursor: wait; opacity: .65; }
button:focus-visible, a:focus-visible, input:focus-visible {
    outline: 2px solid #999;
    outline-offset: 3px;
}
input:focus-visible { outline-color: #707070; outline-offset: 2px; }
.login-form { display: grid; gap: 1rem; }
.login-form input { min-height: 3rem; border-radius: .55rem; padding: .75rem .85rem; font-size: 1rem; }
.login-form button { width: 100%; min-height: 3rem; border-radius: .55rem; background: #f6f6f3; color: #111; font-size: .9rem; }
.signin-card { display: grid; gap: 1.5rem; }
.signin-brand { display: flex; align-items: center; gap: .75rem; font-size: 1.1rem; }
.signin-brand img { width: 2.5rem; height: 2.5rem; object-fit: contain; }
.login-page > header { display: none; }
.login-page #status:empty { display: none; }
.login-page #status:not(:empty) {
    margin: 0; padding: .75rem; border: 1px solid #784747;
    border-radius: .55rem; background: #281818; color: #f6bcbc;
}
.account-actions { display: flex; align-items: center; gap: .5rem; margin-left: 0; }
.profile-icon {
    display: grid; width: 2.5rem; min-width: 2.5rem; height: 2.5rem; place-items: center;
    border: 1px solid #383838; border-radius: .65rem; background: #191919;
    color: #eee; font-size: .85rem; font-weight: 700;
}
.profile-icon svg { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-width: 1.7; }
.sign-out {
    display: inline-flex; min-height: 2.5rem; align-items: center;
    padding: .45rem .65rem; border: 1px solid #383838; border-radius: .65rem; background: #191919;
    text-decoration: none; font-size: .82rem;
}
.sign-out:hover { background: #292929; }
.intro { max-width: 42rem; margin: .5rem 0 1.5rem; }
.upload-panel { display: grid; gap: .75rem; }
.upload-actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
.upload-submit { min-height: 2.5rem; border: 1px solid #383838; background: #191919; color: #f6f6f3; }
.upload-submit:disabled { cursor: not-allowed; opacity: .55; }
.upload-submit:hover { border-color: #777; }
.upload-status { overflow-wrap: anywhere; }
.upload-status img { margin-top: .75rem; border-radius: .5rem; }
.upload-hint { margin: 0; font-size: .75rem; }
.upload-control { min-height: 2.5rem; border: 1px solid #383838; background: #191919; color: #f6f6f3; }
.upload-progress { min-height: 1.5rem; margin: 0; color: #999; font-size: .875rem; }
hanasand-upload-picker { display: block; }
.picker-fallback {
    display: grid; overflow: hidden; grid-template-columns: minmax(0, 1fr);
    border: 1px solid #383838; border-radius: .75rem; background: #101010;
    box-shadow: 0 8px 24px #0005;
}
.picker-fallback-drop-side {
    display: grid; min-height: 11rem; place-items: center;
    border-bottom: 1px solid #383838; background: #191919; padding: .75rem;
}
.picker-fallback-dropzone {
    display: grid; width: 100%; min-height: 9rem; place-content: center;
    justify-items: center; gap: 1rem; border: 1px dashed #383838;
    border-radius: .75rem; background: #101010; padding: 1.25rem; text-align: center;
}
.picker-fallback-icon {
    display: grid; width: 3rem; height: 3rem; place-items: center;
    border: 1px solid #383838; border-radius: .65rem; color: #f6f6f3; font-size: 1.5rem;
}
.picker-fallback-title { color: #f6f6f3; font-size: .875rem; font-weight: 650; }
.picker-fallback-muted { color: #999; font-size: .8rem; }
.picker-fallback-side { display: grid; min-width: 0; align-content: start; gap: 1rem; padding: 1.25rem; }
.picker-fallback-description { margin: 0; color: #999; font-size: .875rem; line-height: 1.5; }
.picker-fallback-browse {
    display: flex; min-height: 2.75rem; align-items: center; justify-content: center;
    border: 1px solid transparent; border-radius: .6rem; background: #f6f6f3;
    color: #111; padding: .7rem .85rem; font-size: .875rem; font-weight: 650; text-align: center;
}
hanasand-upload-picker:defined > .picker-fallback { display: none; }
.gallery {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
    gap: .75rem; margin-top: 1rem; justify-content: start; justify-items: stretch; align-content: start;
}
.gallery[aria-busy="true"] { min-height: 12rem; place-items: center; }
.loading-indicator {
    width: 2rem; height: 2rem; border: 2px solid #383838; border-top-color: #f6f6f3;
    border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.file { min-width: 0; overflow: hidden; border: 1px solid #383838; border-radius: .75rem; background: #080808; }
.file summary { display: block; cursor: pointer; list-style: none; }
.file summary::-webkit-details-marker { display: none; }
.file summary:focus-visible { outline: 2px solid #fff; outline-offset: -2px; }
.preview { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; background: #191919; }
.file-placeholder { display: grid; width: 100%; aspect-ratio: 4 / 3; place-items: center;
    background: #191919; color: #999; font-size: 2rem; }
.file-info { padding: .75rem; overflow-wrap: anywhere; }
.file-info p { margin: .25rem 0; }
.muted { color: #999; }
.photo-viewer {
    width: min(96vw, 90rem); max-width: none; height: min(92dvh, 60rem); max-height: none;
    padding: 0; border: 1px solid #383838; border-radius: 1rem; background: #101010; color: #f6f6f3;
}
.photo-viewer::backdrop { background: #000d; backdrop-filter: blur(8px); }
.viewer-layout { display: grid; width: 100%; height: 100%; grid-template-columns: minmax(0, 1fr) 18rem; }
.viewer-stage { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; background: #070707; }
.viewer-toolbar {
    display: flex; min-height: 3.5rem; align-items: center; justify-content: space-between;
    gap: .75rem; padding: .5rem .75rem;
}
.viewer-toolbar button, .viewer-nav button {
    min-width: 2.5rem; min-height: 2.5rem; border: 1px solid #383838;
    background: #191919; color: #f6f6f3;
}
.viewer-image-wrap { display: grid; min-height: 0; place-items: center; overflow: hidden; padding: 1rem; }
.viewer-image { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.viewer-nav { display: flex; justify-content: space-between; padding: .5rem .75rem; }
.viewer-info { overflow: auto; padding: 1.25rem; border-left: 1px solid #383838; }
.viewer-info h2 { margin: .25rem 0 1rem; overflow-wrap: anywhere; font-size: 1rem; }
.viewer-info p { overflow-wrap: anywhere; }
.viewer-download { display: inline-flex; margin-top: 1rem; }
.gallery-page > header {
    position: sticky; z-index: 5; top: 0; min-height: 3.5rem; padding: .55rem 1.25rem;
    border-bottom: 1px solid #383838; background: #101010; color: #eee;
}
.gallery-page > header.cdn-header--gallery { margin-bottom: 0; }
.gallery-page > header nav { display: flex; align-items: center; gap: .5rem; margin-left: auto; }
.gallery-page > header .hanasand-header__actions { width: auto; flex: 0 0 auto; margin-left: auto; }
.gallery-page > header .cdn-header-actions { width: auto; justify-content: flex-end; margin-left: auto; }
.gallery-page > header .account-actions { margin-left: 0; }
#library-menu-toggle {
    display: inline-flex; min-width: 2.5rem; min-height: 2.5rem; align-items: center; justify-content: center;
    border: 1px solid #383838;
    border-radius: .65rem; background: #191919; color: #eee; padding: .45rem;
}
#library-menu-toggle:hover { background: #292929; }
#library-menu-toggle svg { width: 1.2rem; height: 1.2rem; fill: none; stroke: currentColor; stroke-width: 1.8; }
.gallery-nav-link, .density-control {
    display: inline-flex; min-width: 2.5rem; min-height: 2.5rem; align-items: center;
    justify-content: center; gap: .45rem; border: 1px solid #383838; border-radius: .65rem;
    background: #191919; color: #eee; padding: .45rem .65rem; text-decoration: none;
}
.gallery-nav-link:hover, .density-control:hover { background: #292929; }
.gallery-nav-link svg, .density-control svg { width: 1.2rem; height: 1.2rem; fill: none; stroke: currentColor; stroke-width: 1.7; }
.density-control { position: relative; }
.density-control select {
    position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;
}
.density-control:focus-within { outline: 2px solid #999; outline-offset: 2px; }
.photo-library-layout { display: grid; grid-template-columns: 16rem minmax(0, 1fr); gap: 0; min-height: calc(100vh - 3.5rem); margin: 0; }
.gallery-page.sidebar-collapsed .photo-library-layout { grid-template-columns: 4.25rem minmax(0, 1fr); }
.gallery-page.sidebar-collapsed .library-sidebar { width: 4.25rem; padding: .85rem .45rem; overflow-x: hidden; }
.gallery-page.sidebar-collapsed .library-section { justify-items: center; gap: .3rem; }
.gallery-page.sidebar-collapsed .library-section h2,
.gallery-page.sidebar-collapsed .library-nav-label,
.gallery-page.sidebar-collapsed .album-nav .count { display: none; }
.gallery-page.sidebar-collapsed .library-nav,
.gallery-page.sidebar-collapsed .album-nav {
    width: 2.8rem; min-height: 2.8rem; justify-content: center; padding: .5rem; font-size: 1.1rem;
}
.gallery-page.sidebar-collapsed .library-nav span { font-size: 1.2rem; }
.gallery-page.sidebar-collapsed .new-album {
    width: 2.8rem; height: 2.8rem; overflow: hidden; padding: .4rem; font-size: 0;
}
.gallery-page.sidebar-collapsed .new-album::before { content: '＋'; font-size: 1.2rem; }
.public-library { grid-template-columns: minmax(0, 1fr); }
.library-sidebar {
    position: sticky; top: 3.5rem; display: grid; height: calc(100vh - 3.5rem); overflow-y: auto;
    align-content: start; gap: 1.25rem; padding: 1.25rem .85rem;
    border-right: 1px solid #383838; background: #101010;
}
.library-section { display: grid; gap: .35rem; }
#owned-albums-section:not(.has-owned-albums) > h2,
#owned-albums-section:not(.has-owned-albums) > #owned-albums { display: none; }
.library-sidebar-content { display: grid; align-content: start; gap: 1.25rem; }
.library-section h2 { margin: 0 0 .25rem; color: #999; font-size: .72rem; letter-spacing: .08em; text-transform: uppercase; }
.library-nav, .album-nav {
    display: flex; width: 100%; align-items: center; gap: .6rem; border: 0;
    background: transparent; color: #999; padding: .6rem .7rem;
    text-align: left; font-size: .9rem;
}
.library-nav:hover, .library-nav[aria-current="page"], .album-nav:hover,
.album-nav[aria-current="page"] { border-radius: .6rem; background: #292929; color: #fff; }
.library-nav .count, .album-nav .count { margin-left: auto; color: #999; font-size: .75rem; }
.library-nav-label { min-width: 0; }
.new-album {
    width: 100%; margin-top: .3rem; border: 1px solid #383838;
    background: #191919; color: #eee; padding: .55rem; font-size: .8rem;
}
.library-content { min-width: 0; padding: 1.15rem 1.35rem 2.5rem; }
.library-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.15rem; }
.library-toolbar h2 { margin: 0; font-size: 1.35rem; }
.library-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.library-actions input { width: min(15rem, 35vw); min-height: 2.4rem; padding: .5rem .7rem; font-size: .82rem; }
.date-timeline { display: grid; gap: .4rem; margin: .25rem 0 1rem; }
.date-range { margin: 0; color: #eee; font-size: 1.2rem; font-weight: 650; }
.timeline-months { display: flex; gap: .35rem; overflow-x: auto; padding: .1rem 0 .35rem; }
.timeline-months button {
    flex: 0 0 auto; min-height: 2rem; border: 1px solid #383838; border-radius: 999px;
    background: #191919; color: #999; padding: .35rem .65rem; font-size: .75rem;
}
.timeline-months button:hover, .timeline-months button:focus-visible { background: #292929; color: #fff; }
.timeline-months button[aria-pressed="true"] { background: #f6f6f3; border-color: #f6f6f3; color: #111; }
.library-actions button, .library-actions select, .album-dialog button {
    min-height: 2.4rem; border: 1px solid #383838; border-radius: .55rem;
    background: #191919; color: #eee; padding: .5rem .7rem; font-size: .82rem;
}
#album-target {
    height: 2.4rem; min-width: 8rem; font: inherit; font-size: .82rem;
    line-height: 1.2; color-scheme: dark;
}
.grid-density-control {
    display: inline-flex; height: 2.4rem; min-width: 2.4rem; align-items: center;
    justify-content: center; border: 1px solid #383838; border-radius: .55rem;
    background: #191919; color: #eee; position: relative;
}
.grid-density-control svg { width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-width: 1.8; }
.grid-density-control select {
    position: absolute; inset: 0; width: 100%; min-width: 0; height: 100%;
    border: 0; opacity: 0; padding: 0; cursor: pointer;
}
.grid-density-control:focus-within { outline: 2px solid #999; outline-offset: 2px; }
.library-actions button:disabled { opacity: .5; }
.selection-actions { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: .5rem; }
.photo-group { margin: 1.25rem 0 2rem; }
.photo-group-heading { display: flex; align-items: baseline; gap: .75rem; margin: 0 0 .75rem; }
.photo-group-heading h3 { margin: 0; font-size: 1rem; }
.photo-group-heading span { color: #999; font-size: .85rem; }
.photo-grid {
    display: grid; grid-template-columns: repeat(var(--photo-columns, 5), minmax(0, 1fr));
    gap: 1.6rem 2.25rem; align-content: start;
}
.library-grid { display: grid; align-content: start; }
.library-grid[aria-busy="true"] { min-height: 18rem; place-items: center; }
.library-grid > .loading-indicator { grid-column: 1 / -1; }
.photo-card {
    position: relative; min-width: 0; aspect-ratio: 1; overflow: hidden;
    border: 2px solid transparent; border-radius: .55rem; background: #191919;
    transition: border-color .15s ease, box-shadow .15s ease;
}
.photo-card.is-selected { border-color: #70a7ff; box-shadow: 0 0 0 2px #70a7ff55; background: #163c72; }
.photo-card > button:not(.photo-favorite) { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; }
.photo-card .preview { width: 100%; height: 100%; aspect-ratio: auto; object-fit: cover; transition: transform .18s ease; }
.photo-card > button:hover .preview { transform: scale(1.035); }
.photo-select {
    position: absolute; z-index: 1; top: .55rem; left: .55rem;
    width: 2rem; height: 2rem; margin: 0; opacity: 0; cursor: pointer;
}
.photo-select-indicator {
    position: absolute; z-index: 1; top: .72rem; left: .72rem; display: grid;
    width: 1.35rem; height: 1.35rem; place-items: center; border: 2px solid #fff;
    border-radius: 50%; background: #111c; color: #fff; pointer-events: none;
    filter: drop-shadow(0 1px 3px #000); transition: background .12s ease, transform .12s ease;
}
.photo-card:hover .photo-select-indicator { transform: scale(1.08); }
.photo-select:checked + .photo-select-indicator { border-color: #5e9cff; background: #1769e0; }
.photo-select:checked + .photo-select-indicator::after {
    width: .35rem; height: .65rem; border: solid #fff; border-width: 0 2px 2px 0;
    content: ''; transform: translateY(-1px) rotate(45deg);
}
.photo-select:focus-visible + .photo-select-indicator { outline: 2px solid #fff; outline-offset: 3px; }
.selection-count {
    display: inline-flex; align-items: center; min-height: 2.1rem;
    border: 1px solid #5e9cff; border-radius: 999px;
    background: #5e9cff22; color: #fff; padding: .3rem .7rem;
    font-size: .85rem; font-weight: 600; white-space: nowrap;
}
.selection-count[hidden] { display: none; }
.photo-favorite {
    position: absolute; top: .35rem; right: .35rem; display: grid;
    width: 1.8rem; height: 1.8rem; place-items: center; border: 1px solid #383838;
    border-radius: 50%; background: #111d; color: #fff; padding: 0; font-size: 1rem;
}
.photo-favorite[aria-pressed="true"] { color: #ff6b87; }
.album-remove {
    position: absolute; top: .35rem; right: .35rem; display: grid;
    width: 1.8rem; height: 1.8rem; place-items: center; border: 1px solid #383838;
    border-radius: 50%; background: #111d; color: #fff; padding: 0;
}
.album-dialog {
    width: min(92vw, 30rem); border: 1px solid #383838;
    border-radius: .9rem; background: #101010; color: #eee; padding: 1.25rem;
}
.album-dialog::backdrop { background: #000b; backdrop-filter: blur(5px); }
.album-dialog form { display: grid; gap: .85rem; }
.album-dialog h2 { margin: 0; font-size: 1.15rem; }
.album-dialog label { display: grid; gap: .35rem; color: #999; font-size: .85rem; }
.album-dialog input, .album-dialog select {
    width: 100%; border: 1px solid #383838; background: #080808; color: #fff;
}
.album-dialog .dialog-actions { display: flex; justify-content: flex-end; gap: .5rem; margin-top: .25rem; }
.album-dialog .primary { background: #f6f6f3; color: #111; }
.album-dialog .danger { color: #ff8e8e; }
.album-share-link { overflow-wrap: anywhere; }
@media (max-width: 48rem) {
    main.login-page { padding: 1rem; }
    main.login-page header { align-items: flex-start; flex-direction: column; gap: .5rem; }
    main.login-page header nav { align-self: flex-end; }
    .gallery-page > header { min-height: 3rem; padding: .5rem .8rem; }
    .photo-library-layout { position: relative; display: block; min-height: calc(100vh - 3rem); }
    .library-sidebar {
        display: none; position: absolute; z-index: 8; top: .35rem; left: .5rem;
        width: min(20rem, calc(100vw - 1rem)); height: auto; max-height: calc(100dvh - 4rem);
        overflow-y: auto; padding: 1rem; border: 1px solid #383838; border-radius: .85rem;
        background: #101010; box-shadow: 0 1rem 2rem #0009;
    }
    .library-sidebar.is-open { display: grid; grid-template-columns: minmax(0, 1fr); }
    .library-sidebar-content { gap: .85rem; }
    .library-nav, .album-nav { padding: .5rem; }
    .library-content { padding: .85rem .8rem 2rem; }
    .library-toolbar { display: grid; align-items: start; gap: .6rem; margin-bottom: .75rem; }
    .library-toolbar h2 { font-size: 1.2rem; }
    .library-actions { display: grid; width: 100%; min-width: 0; grid-template-columns: auto minmax(0, 1fr); gap: .45rem; }
    .library-actions input { grid-column: 1 / -1; width: 100%; min-width: 0; }
    .selection-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .4rem; }
    .selection-actions select { min-width: 0; width: 100%; }
    .selection-actions button { min-width: 0; white-space: nowrap; }
    .selection-count { min-height: 2rem; }
    .photo-grid { gap: .55rem; }
    .photo-viewer { width: 100vw; height: 100dvh; border: 0; border-radius: 0; }
    .viewer-layout { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
    .viewer-info { max-height: 30dvh; border-top: 1px solid #383838; border-left: 0; padding: .75rem 1rem; }
    .viewer-info h2 { margin-bottom: .5rem; }
}
@media (min-width: 48.001rem) and (max-width: 80rem),
    (hover: none) and (pointer: coarse) and (min-width: 48.001rem) {
    #library-menu-toggle { display: inline-flex; align-items: center; justify-content: center; }
    .photo-library-layout { grid-template-columns: 4.25rem minmax(0, 1fr); }
    .library-sidebar { width: 4.25rem; padding: .85rem .45rem; overflow-x: hidden; }
    .library-sidebar-content { gap: 1rem; }
    .library-section { justify-items: center; gap: .3rem; }
    .library-section h2, .library-nav-label, .album-nav .count { display: none; }
    .library-nav, .album-nav { width: 2.8rem; min-height: 2.8rem; justify-content: center; padding: .5rem; font-size: 1.1rem; }
    .library-nav span { font-size: 1.2rem; }
    .new-album { width: 2.8rem; height: 2.8rem; overflow: hidden; padding: .4rem; font-size: 0; }
    .new-album::before { content: '＋'; font-size: 1.2rem; }
    .gallery-page.sidebar-expanded .photo-library-layout { grid-template-columns: 15rem minmax(0, 1fr); }
    .sidebar-expanded .library-sidebar { width: 15rem; padding: 1rem .75rem; }
    .sidebar-expanded .library-section { justify-items: stretch; }
    .sidebar-expanded .library-section h2, .sidebar-expanded .library-nav-label,
    .sidebar-expanded .library-section > div { display: grid; }
    .sidebar-expanded .library-nav { width: 100%; justify-content: flex-start; font-size: .9rem; }
    .sidebar-expanded .new-album { width: 100%; height: auto; font-size: .8rem; }
    .sidebar-expanded .new-album::before { content: none; }
}
@media (hover: none) { .photo-select-indicator { opacity: 1; } }
@media (min-width: 48rem) {
    .picker-fallback { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); }
    .picker-fallback-drop-side { min-height: 26.25rem; border-right: 1px solid #383838; border-bottom: 0; padding: 1.5rem; }
    .picker-fallback-dropzone { min-height: 21rem; padding: 2rem; }
    .picker-fallback-side { gap: 1.25rem; padding: 1.5rem; }
}
`

function shell(title: string, body: string, options: {
    mainClass?: string, showBrand?: boolean, showLibraryToggle?: boolean, account?: boolean
} = {}) {
    const bodyClass = options.mainClass === 'gallery-page' ? 'gallery-body' : ''
    const icon = (path: string, extra?: string) => createElement('svg', {
        viewBox: '0 0 24 24', 'aria-hidden': 'true', ...(extra ? { className: extra } : {}),
    }, createElement('path', { d: path }))
    const libraryToggle = options.showLibraryToggle ? createElement('button', {
        id: 'library-menu-toggle', type: 'button', 'aria-controls': 'photo-library-sidebar',
        'aria-expanded': 'false', 'aria-label': 'Browse library', title: 'Browse library',
    }, icon('M4 6h16M4 12h16M4 18h16')) : null
    const galleryLink = createElement('a', {
        className: 'gallery-nav-link', href: '/gallery', 'aria-label': 'Gallery', title: 'Gallery',
    }, createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        createElement('rect', { x: '3', y: '3', width: '8', height: '8', rx: '1' }),
        createElement('rect', { x: '13', y: '3', width: '8', height: '8', rx: '1' }),
        createElement('rect', { x: '3', y: '13', width: '8', height: '8', rx: '1' }),
        createElement('rect', { x: '13', y: '13', width: '8', height: '8', rx: '1' })))
    const uploadLink = createElement('a', {
        className: 'gallery-nav-link', href: '/upload', 'aria-label': 'Upload', title: 'Upload',
    }, createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
        createElement('path', { d: 'M12 16V4m0 0L7 9m5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5' })))
    const accountActions = options.account ? createElement('div', { className: 'account-actions' },
        createElement('span', { className: 'profile-icon', 'aria-label': 'Profile' },
            createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                createElement('circle', { cx: '12', cy: '8', r: '4' }),
                createElement('path', { d: 'M4 21a8 8 0 0 1 16 0' }))),
        createElement('a', { className: 'sign-out', href: '/logout' }, 'Sign out')) : null
    const actions = createElement('div', { className: 'cdn-header-actions' }, libraryToggle, galleryLink, uploadLink, accountActions)
    const sharedHeader = renderToStaticMarkup(createElement(Header, {
        brandHref: '/', brandLabel: 'Hanasand CDN', logoSrc: '/assets/hanasand-logo.png',
        links: [], actions,
        className: [
            'cdn-header',
            options.mainClass === 'gallery-page' ? 'cdn-header--gallery' : '',
            options.showBrand === false ? 'cdn-header--hide-brand' : '',
        ].filter(Boolean).join(' '),
    }))
    const loginAssets = options.mainClass === 'login-page'
        ? '<link rel="stylesheet" href="/assets/login-form.css"><script src="/assets/login-form.js" defer></script>'
        : ''
    return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${title} · Hanasand CDN</title>
<link rel="stylesheet" href="/assets/hanasand-chrome.css">
<style>${styles}</style>
${loginAssets}
<body class="${bodyClass}">
<main class="${options.mainClass || ''}">
${sharedHeader}
<h1>${title}</h1>
${body}
</main>
</body>
</html>`
}

function uploadAuthScript() {
    return `<script>
const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname))
const fileUrl = id => '/api/files/' + encodeURIComponent(id)
const authPicker = document.querySelector('#picker')
window.cdnAuth = fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' }).then(response => {
    if (response.status === 401) return null
    if (!response.ok) throw Error('Your session could not be checked.')
    return response.json()
}).then(auth => {
    if (auth?.id) {
        authPicker.setAttribute('multiple', '')
        document.querySelector('#upload-hint')?.remove()
    } else {
        authPicker.removeAttribute('multiple')
        if (!document.querySelector('#upload-hint')) {
        const hint = document.createElement('p')
        hint.id = 'upload-hint'
        hint.className = 'upload-hint'
        hint.textContent = 'Sign in to upload multiple files at once.'
        document.querySelector('.upload-actions')?.prepend(hint)
        }
    }
    return auth
})
</script>`
}

export async function getUploadPage(req: FastifyRequest, res: FastifyReply) {
    const session = await getSessionDetails(req)
    const userId = session?.id || null
    if (session) setSessionCookies(req, res, session)
    const account = !!session
    const guestHint = userId ? '' : '<p id="upload-hint" class="upload-hint">Sign in to upload multiple files at once.</p>'
    const body = `<p class="intro">Upload images, videos or files.</p>
<form id="upload" class="upload-panel">
<hanasand-upload-picker id="picker"
    description="Choose files to upload, or drag them into the drop area.">
<div class="picker-fallback" aria-hidden="true">
<div class="picker-fallback-drop-side">
<div class="picker-fallback-dropzone"><span class="picker-fallback-icon">↑</span>
<span class="picker-fallback-title">Drop files here</span>
<span class="picker-fallback-muted">or choose files to upload</span></div>
</div>
<div class="picker-fallback-side">
<p class="picker-fallback-description">Choose files to upload, or drag them into the drop area.</p>
<span class="picker-fallback-browse">Browse files</span></div>
</div>
</hanasand-upload-picker>
<div class="upload-actions">
${guestHint}
<button class="upload-submit" type="submit" disabled>Upload</button>
<button id="pause-upload" class="upload-control" type="button" hidden>Pause</button>
</div>
</form>
<p id="status" class="upload-progress" role="status" aria-live="polite"></p>
<script defer src="/assets/exifreader.js"></script>
<script defer src="/assets/upload-picker.js"></script>
<script defer src="/assets/bulk-upload.js"></script>
${uploadAuthScript()}
`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Upload media', body, { account }))
}

export async function getLoginPage(req: FastifyRequest, res: FastifyReply) {
    const query = req.query as { returnTo?: unknown } | undefined
    const redirectPath = safeCdnReturnPath(query?.returnTo)
    const ssoHref = `/api/auth/sso/start?redirectPath=${encodeURIComponent(redirectPath)}`
    const body = renderHanasandLoginFormMarkup({
        loginUrl: '/api/auth/login',
        passkeyOptionsUrl: '/api/auth/passkeys/authenticate/options',
        passkeyVerifyUrl: '/api/auth/passkeys/authenticate/verify',
        ssoHref,
        redirectPath,
    })
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(shell('Sign in', body, { mainClass: 'login-page' }))
}

export async function getGalleryPage(_req: FastifyRequest, res: FastifyReply) {
    const session = await getSessionDetails(_req)
    if (session) setSessionCookies(_req, res, session)
    const account = !!session
    const body = `<div id="photo-library" class="photo-library-layout" aria-busy="true">
<aside id="photo-library-sidebar" class="library-sidebar" aria-label="Photo library">
<div class="library-sidebar-content">
<div class="library-section"><h2>Library</h2>
<button class="library-nav" data-view="library" aria-current="page" aria-label="All photos" title="All photos">
<span aria-hidden="true">▦</span><span class="library-nav-label">All photos</span></button>
<button class="library-nav" data-view="recent" aria-label="Recent" title="Recent">
<span aria-hidden="true">◷</span><span class="library-nav-label">Recent</span></button></div>
<div class="library-section"><h2>Collections</h2>
<button class="library-nav" data-view="favorites" aria-label="Favorites" title="Favorites">
<span aria-hidden="true">♡</span><span class="library-nav-label">Favorites</span></button>
<button class="library-nav" data-view="images" aria-label="Images" title="Images">
<span aria-hidden="true">▧</span><span class="library-nav-label">Images</span></button>
<button class="library-nav" data-view="videos" aria-label="Videos" title="Videos">
<span aria-hidden="true">▷</span><span class="library-nav-label">Videos</span></button></div>
<div class="library-section" id="owned-albums-section"><h2>Albums</h2><div id="owned-albums"></div>
<button id="create-album" class="new-album" type="button" aria-label="New album" title="New album">＋ New album</button></div>
<div class="library-section" id="shared-albums-section" hidden><h2>Shared with me</h2><div id="shared-albums"></div></div>
</div>
</aside>
<section class="library-content" aria-label="Photos">
<div class="library-toolbar"><h2 id="view-title">Library</h2><div class="library-actions">
<input id="photo-search" type="search" placeholder="Search photos" aria-label="Search photos" autocomplete="off">
<label class="grid-density-control" title="Images per row">
<svg viewBox="0 0 24 24" aria-hidden="true">
<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
<rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
<select id="grid-density" aria-label="Images per row">
<option value="1">1 per row</option><option value="3">3 per row</option>
<option value="5" selected>5 per row</option></select>
</label>
<span id="selection-count" class="selection-count" aria-live="polite" aria-atomic="true" hidden></span>
<div id="selection-actions" class="selection-actions" hidden>
<select id="album-target" aria-label="Choose an album"><option value="">Add to album</option></select>
<button id="add-to-album" type="button" disabled>Add selected</button>
<button id="manage-album" type="button" hidden>Share</button>
</div>
<button id="load-more" type="button" hidden>Load more</button>
</div></div>
<div id="date-timeline" class="date-timeline" aria-label="Browse by date" hidden></div>
<div id="files" class="library-grid" aria-live="polite" aria-busy="true">
<span class="loading-indicator" role="status" aria-label="Loading photos"></span></div>
</section></div>
<dialog id="photo-viewer" class="photo-viewer" aria-label="Photo viewer"><div class="viewer-layout">
<div class="viewer-stage"><div class="viewer-toolbar"><span id="viewer-count" class="muted"></span>
<button id="viewer-close" type="button" aria-label="Close photo">×</button></div>
<div class="viewer-image-wrap"><img id="viewer-image" class="viewer-image" alt="">
<video id="viewer-video" class="viewer-image" controls playsinline hidden></video></div>
<div class="viewer-nav"><button id="viewer-prev" type="button" aria-label="Previous photo">‹</button>
<button id="viewer-next" type="button" aria-label="Next photo">›</button></div></div>
<aside id="viewer-info" class="viewer-info"></aside></div></dialog>
<dialog id="album-form" class="album-dialog"></dialog>
<script>
window.cdnAuth = fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' }).then(response => {
    if (response.status === 401) return null
    if (!response.ok) throw Error('Your photo library could not be loaded.')
    return response.json()
})
</script>
<script src="/assets/gallery.js" defer></script>`
    return res.header('Cache-Control', 'private, no-store').type('text/html').send(
        shell('Library', body, {
            mainClass: 'gallery-page', showBrand: false, showLibraryToggle: true,
            account,
        }),
    )
}

export async function getSharedAlbumPage(req: FastifyRequest, res: FastifyReply) {
    const { token } = req.params as { token: string }
    const body = `<div id="photo-library" class="photo-library-layout public-library"
    data-public-token="${encodeURIComponent(token)}" aria-busy="true">
<section class="library-content" aria-label="Shared album">
<div class="library-toolbar"><h2 id="view-title">Shared album</h2></div>
<div id="date-timeline" class="date-timeline" aria-label="Browse by date" hidden></div>
<div id="files" class="library-grid" aria-live="polite" aria-busy="true">
<span class="loading-indicator" role="status" aria-label="Loading photos"></span></div>
<button id="load-more" type="button" hidden>Load more</button>
</section></div>
<dialog id="photo-viewer" class="photo-viewer" aria-label="Photo viewer"><div class="viewer-layout">
<div class="viewer-stage"><div class="viewer-toolbar"><span id="viewer-count" class="muted"></span>
<button id="viewer-close" type="button" aria-label="Close photo">×</button></div>
<div class="viewer-image-wrap"><img id="viewer-image" class="viewer-image" alt="">
<video id="viewer-video" class="viewer-image" controls playsinline hidden></video></div>
<div class="viewer-nav"><button id="viewer-prev" type="button" aria-label="Previous photo">‹</button>
<button id="viewer-next" type="button" aria-label="Next photo">›</button></div></div>
<aside id="viewer-info" class="viewer-info"></aside></div></dialog>
<dialog id="album-form" class="album-dialog"></dialog>
<script src="/assets/gallery.js" defer></script>`
    return res.header('Cache-Control', 'no-store').type('text/html').send(
        shell('Shared album', body, { mainClass: 'gallery-page', showBrand: false }),
    )
}
