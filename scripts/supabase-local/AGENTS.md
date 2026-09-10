# LOCAL SUPABASE MODULE GUIDE

## OVERVIEW
This directory implements guarded local Supabase lifecycle, Docker identity, locks, subprocesses, status, receipts, and cleanup.

## MODULE MAP
- `lifecycle.mjs`: guarded start, reset, test, status, stop, and cleanup orchestration.
- `docker.mjs`, `receipt.mjs`, `lock.mjs`: daemon identity and mutation ownership proof.
- `next-dev.mjs`, `app-env.mjs`, `spawn.mjs`: fixed-port Next child and sealed subprocess boundary.
- `status-config.mjs`: parses only the expected loopback local Supabase status.

## OWNERSHIP
- Project ID is `spolink`; endpoints are loopback-only.
- Start/reset/stop mutate only resources with a current-run ownership receipt.
- Lock and receipt schemas are strict and mode `0600`; evidence directories are `0700`.
- Stop browser/Next/Supabase in owner order and require ports/resources to be zero.
- Dead/stale owner recovery remains fail-closed for unowned or ambiguous resources.

## FAILURE TESTING
Cover signal interruption, stale locks, concurrent starts, readiness failure, wrong Docker identity, reset failure, child exit propagation, and receipt verdict consistency.

## VERIFY
```bash
corepack pnpm supabase:doctor
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm supabase:test:db
corepack pnpm supabase:stop
corepack pnpm supabase:assert-stopped
node --test tests/supabase-local-guard.test.mjs
```
