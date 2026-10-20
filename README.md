# Hanasand CDN

Standalone file storage and sharing service for Hanasand. The CDN host serves its own sign-in, upload, and gallery pages. Sign-in and session validation use the Identity API directly; uploads and library requests use this service's API, without depending on the Hanasand website or Hanasand API.

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

Uploads return a public share URL at `https://cdn.hanasand.com/files/<file-id>`. Supported image and video types render inline. The gallery uses the shared Hanasand Identity cookies to validate the session server-side, and shows previews for supported images.

## Development

Use Bun and the dependencies in `package.json`:

```sh
bun install
bun run start
```

The API listens on port `8081` by default. Run `bun run test:e2e:traffic` against a locally running service for the focused browser traffic check. `bun run audit:api` creates and removes a temporary account and needs isolated CDN and Hanasand API databases; never point it at production.

## Upload limits and storage

Authenticated uploads accept files up to 50 MiB, with up to four concurrent uploads and 60 upload attempts per account per hour. The Hanasand upload form currently caps local and remote media at 20 MiB. Default per-account storage is 5 GiB and total storage is 100 GiB. Uploads stop when the volume has less than 10 GiB free. These limits can be changed with `CDN_USER_STORAGE_LIMIT_BYTES`, `CDN_STORAGE_LIMIT_BYTES`, and `CDN_MIN_FREE_BYTES`.

New files are stored in the Compose volume mounted at `/var/lib/cdn/files`; PostgreSQL stores ownership and file metadata. Back up both the database and file volume. Existing database-backed files remain readable.

`GET /health` checks the database and file storage. Browser access from Hanasand is limited by CORS to the configured origins (`CDN_CORS_ORIGINS`). Uploaded files with supported image or video types may render inline; other types are downloaded as attachments.
