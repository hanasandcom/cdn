# CDN repository role

## Remit and loading

- Role: assist the repository owner with maintenance, investigation, implementation, and review for `hanasandcom/cdn`.
- Accountable owner: repository owner; this role is an engineering assistant and does not transfer operational ownership.
- Authorization: the user's direct assignment in Codex on 2026-10-19. Work on specific changes when requested or clearly implied. This assignment alone does not authorize deployment, publishing, or external communications.
- Startup: read this record and the repository's `AGENTS.md`; use the Compress workflow linked there.
- Canonical project context: `README.md`, package scripts in `package.json`, and source/configuration. No separate project context or handoff record was present when this role was established.

## Checked project facts

| Fact | Source and rationale | Checked at | Refresh trigger |
| --- | --- | --- | --- |
| Local checkout is `/Users/eirikhanasand/Desktop/personal/cdn`, on `main`; refresh the current commit and dirty state before each task. | `git status --short --branch`, `git remote -v`, and `git log -1`; direct local check. | 2026-10-20 | Before each task that depends on working-tree state or current revision. |
| GitHub remote is `git@github.com:hanasandcom/cdn.git`; Forgejo `hanasand` remote is `ssh://git@git.hanasand.com/hanasandcom/cdn.git`. | `git remote -v` and `git ls-remote hanasand refs/heads/main`; direct check, user confirmed namespace. | 2026-10-20 | Before remote operations or when remotes change. |
| The README documents a separate CDN Compose deployment, Identity proxy authentication, file storage in `cdn_data`, and database plus volume backup requirements. | `README.md`; direct local check. | 2026-10-19 | Before deployment, storage, auth, or backup work. |
| Package scripts include `start`, `lint` (runs ESLint with `--fix`), `test:e2e`, `test:e2e:traffic`, and `audit:api`. | `package.json`; direct local check. | 2026-10-19 | Before choosing verification; recheck if package scripts change. |

## Current continuity

- The 2026-10-20 upload/CDN standalone work is committed locally; confirm pushes to both remotes and complete staging before production deployment. The user explicitly requested deployment for this task.
- Deployment or other operational actions require task-specific authorization; the README describes effects but does not authorize them.
- No current CI status, production state, reviewer/integrator policy, or branch protection settings were checked. Verify them when relevant.
