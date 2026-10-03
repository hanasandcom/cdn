#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Keep CDN deployments in their own Compose project so they cannot reconcile
# or remove services owned by the Hanasand application stack.
docker compose \
    --project-directory "$root" \
    --project-name cdn \
    -f "$root/docker-compose.yml" \
    up --detach --build cdn
