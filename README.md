# Hanasand CDN

Standalone file storage and sharing service for Hanasand. The CDN host serves upload and gallery pages and redirects sign-in requests to the shared Identity page. Uploads and library requests use this service's API, without depending on the Hanasand website or public Hanasand API.

## Run with Docker Compose

Install Docker Compose v2 and create a local `.env` file with `DB_PASSWORD` set. The Compose project is named `cdn`, with its own PostgreSQL database and persistent file storage. The service also joins the external Identity network so it can create and validate account sessions; create that network before starting the stack. `CDN_AUTH_API_URL` defaults to `http://identity:8081/api`.

On Inspur, follow [storage and deployment](docs/storage.md) and use `./scripts/deploy-inspur.sh`. PostgreSQL and uploaded files live under `/data/cdn` on the data RAID. Existing installations must migrate their data before using these paths. For local development, set `CDN_POSTGRES_DIR` and `CDN_FILES_DIR` to prepared local directories.

From this directory:

```sh
docker compose up -d --build
```

To stop the services while preserving uploaded files and the database:

```sh
docker compose down
```

The CDN API is published on port `8501` and its database on `8502`. Do not expose the database port to untrusted networks. Compose reads optional settings from `.env`; see `docker-compose.yml` for defaults and network names.

Uploads return public share URLs at `https://cdn.hanasand.com/api/files/<file-id>`. Guests can select and upload one file at a time. Signed-in users can select multiple files, and the upload page sends batches of up to 5,000 files and 45 MiB to `POST /api/files/bulk` (the `X-CDN-Upload-Count` header must match the multipart file count). Per-file progress and retry are shown in the selected-file list. An interrupted import can be resumed after refresh by selecting the original files again; the queue is saved in that browser's IndexedDB, while server-side upload keys make retried requests safe if the original response was lost. File data is not copied into browser storage. The smaller request-size cap leaves room under the CDN host's 50 MiB proxy limit for multipart headers. The gallery loads 100 files at a time and loads the next page as you scroll, sorted by photo date when available. All Photos shows older photos above newer ones, opens at the newest photos at the bottom, and loads older pages as you scroll upward while preserving your place. It clears any selected month when opened. Images fit inside the full-screen viewer, and photo controls appear on hover or keyboard focus; Select keeps selection controls visible. Browser-supported image and video types render inline. Session checks use the Hanasand Identity API. The legacy `/files/<file-id>` address redirects to the canonical API URL. Gallery, upload, and sign-in pages bypass Varnish caching so released UI changes appear immediately.

Both `cdn.hanasand.com/upload` and `hanasand.com/upload` use the upload picker in `src/client/upload-picker.js`. The main website loads the public `/assets/upload-picker.js` and `/assets/exifreader.js` assets from this service; its own URL import and publish review remain on Hanasand. This keeps the drop area, browse controls, file list, and photo details consistent while the CDN keeps its own upload and gallery flows. The CDN `/login` route redirects to `https://identity.hanasand.com/login` with a validated absolute CDN return URL. The gallery redirects signed-out visitors to Identity before serving library HTML. Identity sets the shared session cookies and returns users to the requested CDN page after sign-in.

## Photo library

The signed-in gallery provides all photos, recent uploads, favorites, images, and videos. Search matches filenames, embedded place names, and GPS coordinates. Its month index covers the full library and each album, so users can jump directly to older dates beyond the currently loaded page. All Photos groups photos by capture month. Other views also show place or GPS coordinate groups. EXIF capture times retain their camera timezone when available; local capture times without an offset keep their recorded wall-clock date. JPEG, PNG, GIF, WebP, AVIF, and HEIC/HEIF files can render where the browser supports them. Dates and locations are read during upload; no geocoding request sends photo coordinates to a third party. Albums are stored in PostgreSQL and can contain files owned by their creator or a contributor. Owners can invite another Hanasand account by its account ID, grant view or contribute access, or make an album public with a random, unguessable link at `/shared/<token>`. Public links can be disabled by turning off public access. Private album files require an album owner or member session, including when requested through the legacy file path. Gallery media and album routes bypass Varnish so private access checks cannot reuse a cached public response.

Large images get a stored 480 × 480 WebP thumbnail for the gallery grid; the original remains available for the full-size viewer and download. Existing images get thumbnails the first time the gallery requests them. Thumbnail requests use the same private-album access checks as original files. Video posters are generated on demand with FFmpeg. MOV playback uses a stored H.264/AAC MP4 preview; native MP4, WebM, and Ogg playback uses the original with byte-range support. Originals are preserved. Preview generation runs one job at a time with a queue of 16 files; MOV conversion is limited to one hour, 2 GiB input, 512 MiB output, and ten minutes of processing. Unsupported videos retain a Download original link. FFmpeg is included in the Docker image.

Moving a photo or video to Trash hides it from the library, albums, and file links for 30 days. Its owner can restore it or confirm permanent deletion. Restore retains album membership and private access, even if a private album was removed while the file was in Trash. An hourly cleanup removes expired files in batches of five; interrupted permanent deletions are retried. Trash and generated previews count toward storage usage until removed. Other file types retain the existing immediate-delete API behavior.

Right-click an album or use its **Actions** (⋯) button to open, rename, pin, share, or delete it. Keyboard users can open the menu with Shift+F10, or focus Actions and press Enter. Pins belong to your account and stay at the top of each album list across devices. Shared-album members can open and pin; renaming, deleting, and changing sharing are reserved for the owner. Deleting an album keeps its photos in the library and asks for confirmation. Sharing supports a Hanasand account ID with view or contribute access, plus an optional public link that can be copied or disabled.

Album operations are available under `GET/POST /api/albums`, `GET/PATCH/DELETE /api/albums/:id`, `PUT /api/albums/:id/pin` with `{ "isPinned": true }` (or `false`), `POST /api/albums/:id/items`, `DELETE /api/albums/:id/items/:fileId`, `POST /api/albums/:id/members`, and `DELETE /api/albums/:id/members/:userId`. `GET /api/albums/public/:token` serves read-only public album contents. Existing databases gain the album and photo metadata tables/columns at service startup.

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

New files are stored in `/data/cdn/files`, mounted at `/var/lib/cdn/files`; PostgreSQL stores ownership and file metadata in `/data/cdn/postgres`. Back up both directories together. Existing database-backed files remain readable.

`GET /health` checks the database and file storage. Browser access from Hanasand is limited by CORS to the configured origins (`CDN_CORS_ORIGINS`). Uploaded files with supported image or video types may render inline; other types are downloaded as attachments.
