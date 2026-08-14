# SCRIPT GUIDE

## OVERVIEW

`scripts/` owns guarded local Supabase lifecycle, deterministic region generation, and scoped
source-manifest verification. These scripts may manage processes and Docker resources.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Local auth launcher | `dev-local.mjs` |
| CLI dispatch | `supabase-local.mjs` |
| Lifecycle orchestration | `supabase-local/lifecycle.mjs` |
| Docker identity/resources | `supabase-local/docker.mjs` |
| Ownership receipts | `supabase-local/receipt.mjs` |
| Concurrency lock | `supabase-local/lock.mjs` |
| Sealed subprocess env | `supabase-local/env.mjs`, `spawn.mjs` |
| Local status validation | `supabase-local/status-config.mjs` |
| Region catalog | `generate-lesson-regions.mjs` |
| Direction allowlist | `opencode-direction-allowlist-manifest.mjs`, verifier |

## SAFETY RULES

- Project ID is exactly `spolink`; API/DB endpoints must be loopback.
- Never operate on Docker resources without a matching current-run ownership receipt.
- Start rejects pre-existing `.supabase`, `supabase/.temp`, project containers, volumes, or networks.
- Lifecycle commands use a lock; receipts have exact schemas, mode `0600`, and freshness checks.
- Spawn children without a shell and pass only the allowlisted environment.
- Stop only owned processes/directories, then prove ports and Docker resources are zero.
- Do not weaken daemon identity checks or make Docker installation implicit.
- Keep `corepack pnpm exec supabase`; do not switch to a global or direct `pnpm` binary.
- `corepack pnpm dev:local` reserves exactly `127.0.0.1:3000`; an occupied port is a hard failure.
- A launcher-owned fresh Supabase runtime stops with the launcher. A valid reused runtime remains;
  stop it explicitly with `corepack pnpm supabase:stop`, then run `supabase:assert-stopped`.
- `dev:local` is local development guidance only, not hosted Supabase or production setup.
- Region generation verifies immutable SHA-256, BOM, headers, hierarchy, and deterministic output.
- Allowlist verification rejects unlisted additions, modifications, and deletions.

## VERIFY

```bash
corepack pnpm dev:local
corepack pnpm supabase:doctor
node --test tests/supabase-local-guard.test.mjs
node scripts/generate-lesson-regions.mjs --check
corepack pnpm supabase:assert-stopped
```

Lifecycle tests must cover failure cleanup, stale receipts, concurrent starts, and identity mismatch.
