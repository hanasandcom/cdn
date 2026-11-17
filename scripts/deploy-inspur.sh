#!/bin/sh
# Run from the fast-forwarded production checkout after migrating existing data.
set -eu
cd "$(dirname "$0")/.."
exec 9>/tmp/cdn-deploy.lock
flock -n 9 || { echo "Another CDN deployment is running." >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "Deploy main only." >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Deployment checkout must be clean (including untracked files)." >&2; exit 1; }
# Inspect resolved Compose paths so .env overrides cannot bypass the disk check.
paths=$(docker compose config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)
for service,target in [("postgres","/var/lib/postgresql/data"),("cdn","/var/lib/cdn/files")]:
    v=next(v for v in c["services"][service]["volumes"] if v["target"]==target)
    assert v["type"]=="bind", "Persistent storage must use an explicit bind mount"
    print(v["source"])
')
expected_uuid=cbfaacde-3ea2-4fc3-8c43-d63f6eb706cc
printf '%s\n' "$paths" | while IFS= read -r path; do
    [ -d "$path" ] || { echo "Missing migrated storage: $path" >&2; exit 1; }
    actual_uuid=$(findmnt -n -o UUID --target "$path")
    [ "$actual_uuid" = "$expected_uuid" ] || {
        echo "Refusing deployment: $path is not on Inspur's data RAID." >&2; exit 1;
    }
done
# An empty directory must never silently initialize a replacement production DB.
postgres_path=$(printf '%s\n' "$paths" | head -n 1)
docker run --rm --network none --mount "type=bind,src=$postgres_path,dst=/cluster,readonly" \
    --entrypoint sh postgres:15 -ceu '
    test "$(cat /cluster/PG_VERSION)" = 15
    pg_controldata /cluster >/dev/null
'
export HANASAND_RELEASE_COMMIT=$(git rev-parse HEAD)
# A failed build must leave running services intact.
docker compose build cdn cdn_cron
docker compose up -d --wait --wait-timeout 180
curl --fail --silent --show-error http://127.0.0.1:8501/health
printf '\nDeployed CDN %s\n' "$HANASAND_RELEASE_COMMIT"
