# Inspur storage and deployment

The four 3.5 TiB disks form `/dev/md0`, a 10.5 TiB RAID5 filesystem mounted at
`/data` (UUID `cbfaacde-3ea2-4fc3-8c43-d63f6eb706cc`). The 1.9 TiB system disk
contains `/` and Docker's default volume directory. RAID5 tolerates one failed
member; it does not replace backups.

CDN PostgreSQL uses `/data/cdn/postgres`, and uploaded files use `/data/cdn/files`.
Compose refuses to create missing source directories. For an isolated development
instance, set `CDN_POSTGRES_DIR` and `CDN_FILES_DIR` to prepared local directories.
Do not change either path on an existing installation without migrating its data.
Changing a volume path does not move any bytes.

After publishing local `main`, fast-forward `/home/hanasand/cdn` on Inspur and run:

```sh
./scripts/deploy-inspur.sh
```

The script checks both resolved storage paths against the RAID filesystem UUID,
builds before replacing containers, and waits for service health. PostgreSQL must
be healthy before the app and scheduled worker start. Use this entry point for
production releases. The README's generic Compose command also uses the explicit
storage paths.
If `/data` is unavailable after boot, restore its mount before starting CDN. Never
create replacement directories on the root disk to make startup succeed.

## Migration and recovery

1. Confirm the mounted filesystem, free capacity, PostgreSQL major version, and
   source volumes. Check for external tablespaces or a separately mounted WAL.
2. Stop the CDN app and scheduled worker, then stop PostgreSQL cleanly. Keep all
   database writers stopped until the copy is verified.
3. Preserve the original `cdn_postgres_data` and `cdn_data` volumes. Copy the entire
   stopped cluster, including WAL, and the complete file volume to the new paths,
   preserving numeric ownership and permissions. Keep a separate backup archive.
4. Compare SHA-256 manifests of all source and destination files before starting
   PostgreSQL. Retain those manifests with the backup. Check the backup archive
   checksum, and test restoring the archive into an isolated PostgreSQL 15 instance.
5. Compare database table counts, run PostgreSQL integrity checks, then deploy and
   verify `/health`, pages, authentication redirects, and a stored-file read.

The original volumes are a frozen rollback copy. Once the new database accepts
writes, switching back would lose those writes: stop all writers and copy the new
state back, or restore a suitable current backup. Never start both database copies
as production writers. Do not remove the originals or migration backups until their
retention has been explicitly decided. Back up database and files together to a
separate machine; archives on the RAID do not protect against loss of that array.

Keep the OS disk separate from the data RAID. A single path namespace can simplify
service configuration without combining their failure domains. Add data storage to
the data tier through a separately planned, backed-up migration; do not merge the
boot disk into this RAID as part of an outage repair.
