# Hanasand CDN

Standalone file storage and sharing service for Hanasand. The CDN host serves its own sign-in, upload, and gallery pages. It bundles the shared Identity login component at build time and serves it from same-origin CDN endpoints. Sign-in requests go from the CDN API directly to Identity. Uploads and library requests use this service's API, without depending on the Hanasand website or public Hanasand API.

## Run with Docker Compose

Install Docker Compose v2 and create a local `.env` file with `DB_PASSWORD` set. The Compose project is named `cdn`, with its own PostgreSQL database and persistent file volume. The service also joins the external Identity network so it can create and validate account sessions; create that network before starting the stack. `CDN_AUTH_API_URL` defaults to `http://identity:8081/api`.

From this directory:

```sh
docker compose up -d --build
```

To stop the services while preserving uploaded files and the database:

```sh
docker compose down
```

The CDN API is published on port `8501` and its database on `8502`. Do not expose the database port to untrusted networks. Compose reads optional settings from `.env`; see `docker-compose.yml` for defaults and network names.

Uploads return public share URLs at `https://cdn.hanasand.com/api/files/<file-id>`. Guests can select and upload one file at a time. Signed-in users can select multiple files, and the upload page sends batches of up to 5,000 files and 45 MiB to `POST /api/files/bulk` (the `X-CDN-Upload-Count` header must match the multipart file count). The smaller request-size cap leaves room under the CDN host's 50 MiB proxy limit for multipart headers. The gallery loads 100 files at a time, sorted by photo date when available, so large libraries do not require one enormous response. Browser-supported image and video types render inline. Session checks use the Hanasand Identity API. The legacy `/files/<file-id>` address redirects to the canonical API URL. Gallery, upload, and sign-in pages bypass Varnish caching so released UI changes appear immediately.

Both `cdn.hanasand.com/upload` and `hanasand.com/upload` use the upload picker in `src/client/upload-picker.js`. The main website loads the public `/assets/upload-picker.js` and `/assets/exifreader.js` assets from this service; its own URL import and publish review remain on Hanasand. This keeps the drop area, browse controls, file list, and photo details consistent while the CDN keeps its own upload and gallery flows. The CDN login page renders the shared `hanasand-login-form` controls in its initial HTML and registers the shared browser component from the published `hanasand` package; `bun run build:auth-client` bundles its browser entry and stylesheet into CDN-local assets. Password, passkey, and Google sign-in use same-origin CDN routes that call Identity and set shared session cookies. Google sign-in returns to CDN through Identity's configured callback, so the browser flow does not require Hanasand's website or a public Identity API asset.

## Photo library

The signed-in gallery provides all photos, recent uploads, favorites, images, and videos. Search matches filenames, embedded place names, and GPS coordinates. Its month index covers the full library and each album, so users can jump directly to older dates beyond the currently loaded page. Photos are grouped by capture date, then place or GPS coordinates. EXIF capture times retain their camera timezone when available; local capture times without an offset keep their recorded wall-clock date. JPEG, PNG, GIF, WebP, AVIF, and HEIC/HEIF files can render where the browser supports them. Dates and locations are read during upload; no geocoding request sends photo coordinates to a third party. Albums are stored in PostgreSQL and can contain files owned by their creator or a contributor. Owners can invite another Hanasand account by its account ID, grant view or contribute access, or make an album public with a random, unguessable link at `/shared/<token>`. Public links can be disabled by turning off public access. Private album files require an album owner or member session, including when requested through the legacy file path. Gallery media and album routes bypass Varnish so private access checks cannot reuse a cached public response.

Large images get a stored 480 × 480 WebP thumbnail for the gallery grid; the original remains available for the full-size viewer and download. Existing images get thumbnails the first time the gallery requests them. Thumbnail requests use the same private-album access checks as original files.

Album operations are available under `GET/POST /api/albums`, `GET/PATCH/DELETE /api/albums/:id`, `POST /api/albums/:id/items`, `DELETE /api/albums/:id/items/:fileId`, `POST /api/albums/:id/members`, and `DELETE /api/albums/:id/members/:userId`. `GET /api/albums/public/:token` serves read-only public album contents. Existing databases gain the album and photo metadata tables/columns at service startup.

## Development

Use Bun and the dependencies in `package.json`:

```sh
bun install
bun run build:auth-client
bun run start
```

The API listens on port `8081` by default. Run `bun run test:e2e:traffic` against a locally running service for the focused browser traffic check. `bun run audit:api` creates and removes a temporary account and needs isolated CDN and Hanasand API databases; never point it at production.

## Upload limits and storage

Guest uploads allow one file per second and one in-flight upload per client IP. Their files use a keyed IP pseudonym for ownership and share the 5 GiB per-owner storage limit; the raw client IP is not stored in the file owner field. Users behind the same public IP share the guest limit. Guests cannot use bulk upload. Signed-in standard uploads are limited to one file per second per account. The authenticated bulk endpoint accepts up to 5,000 files and 45 MiB per request and applies a per-account rate of 5,000 files per second; the rate is an admission limit, not a promise that the network, disk, and database can persist 5,000 files in one second. Files larger than 45 MiB are sent through the standard endpoint. Upload requests are limited to four concurrent requests across the service. Each file is limited to 50 MiB. Default per-account storage is 5 GiB and total storage is 100 GiB. Uploads stop when the volume has less than 10 GiB free. These limits can be changed with `CDN_USER_STORAGE_LIMIT_BYTES`, `CDN_STORAGE_LIMIT_BYTES`, and `CDN_MIN_FREE_BYTES`.

New files are stored in the Compose volume mounted at `/var/lib/cdn/files`; PostgreSQL stores ownership and file metadata. Back up both the database and file volume. Existing database-backed files remain readable.

`GET /health` checks the database and file storage. Browser access from Hanasand is limited by CORS to the configured origins (`CDN_CORS_ORIGINS`). Uploaded files with supported image or video types may render inline; other types are downloaded as attachments.
