#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release=$(git -C "$root" rev-parse HEAD)

# Keep CDN deployments in their own Compose project so they cannot reconcile
# or remove services owned by the Hanasand application stack.
docker compose \
    --project-directory "$root" \
    --project-name cdn \
    -f "$root/docker-compose.yml" \
    build --build-arg "HANASAND_RELEASE_COMMIT=$release" cdn

docker compose \
    --project-directory "$root" \
    --project-name cdn \
    -f "$root/docker-compose.yml" \
    up --detach --no-build cdn
