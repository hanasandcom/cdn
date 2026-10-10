# cdn.hanasand.com
Hanasand CDN

## Deploy

Run `./scripts/deploy-cdn.sh` from any working directory to build and update
only the CDN service and start its PostgreSQL dependency if needed. It always
uses the separate `cdn` Compose project; the Hanasand application deployment
does not build, recreate, or remove CDN services.

The CDN API uses its own PostgreSQL service and connection budget (`CDN_DB_MAX_CONN`, default 100; traffic writes use up to 5 of those connections). It sends token and role checks directly to Identity over `hanasand_identity_proxy`; it does not call the Hanasand API. Its Compose project must be able to join that private Identity network.

## File library storage

New authenticated uploads are written to the `cdn_data` volume mounted at
`/var/lib/cdn/files`. PostgreSQL keeps ownership and file metadata. Existing
database-backed files remain readable without migration.

Uploads are limited to 50 MiB per file, four concurrent requests, and 60 attempts
per account per hour. The public media UI limits files to 20 MiB.
Default account storage is 5 GiB and total file storage is 100 GiB.
Uploads stop if fewer than 10 GiB would remain on the filesystem.
Configure these using `CDN_USER_STORAGE_LIMIT_BYTES`,
`CDN_STORAGE_LIMIT_BYTES`, and `CDN_MIN_FREE_BYTES`.

`GET /health` checks the database and file filesystem without caching.
It returns 503 at 80% storage use, below 20 GiB free, or after more than
1 GiB of uploads within 15 minutes. The Hanasand repository's
`api/scripts/setup-cdn-monitoring.ts` installs public availability and
storage checks in the Hanasand organization.

Back up both the PostgreSQL database and `cdn_data` to preserve new uploads.
