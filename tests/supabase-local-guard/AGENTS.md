# LOCAL SUPABASE GUARD TEST GUIDE

## OVERVIEW

This directory proves that local Supabase, Docker, port, receipt, and child-process ownership fail
closed without mutating ambient resources.

## TEST MAP

| Concern | Files |
|---|---|
| Receipt and ownership | `receipt.test.mjs`, `ownership.test.mjs`, `authorization.test.mjs` |
| Lock and concurrency | `lock.test.mjs`, `spawn-supervisor.test.mjs` |
| Docker identity | `docker-and-spawn.test.mjs`, `docker-quit-identity.test.mjs` |
| Local launcher | `local-dev-*.test.mjs`, `local-next-child.test.mjs` |
| Cleanup proof | `cleanup.test.mjs`, `temp-residue.test.mjs`, `assert-stopped-*.test.mjs` |

## ISOLATION AND OWNERSHIP

- Use `mkdtemp()` workspaces, injected runners, and fake process/Docker observations; never operate
  on the repository's live runtime from a unit test.
- Destructive actions require a current-run receipt plus matching resource ownership proof.
- Missing, stale, malformed, symlinked, or mode-invalid receipts fail closed; keep the explicit clean
  absent-receipt assertion separate from dirty-state recovery.
- Distinguish launcher-owned fresh runtimes from valid reused runtimes. Cleanup must preserve reused
  Supabase and Docker resources while freeing only resources owned by the current run.
- Lock cases retain live/dead PID, malformed lock, concurrent acquire, and action-failure cleanup.

## PROCESS AND EVIDENCE

- Assert Corepack/Supabase argv, shell-free spawn, allowlisted environment, process-group descendant
  cleanup, and TERM-to-KILL escalation.
- Receipt and zero-resource proof schemas stay exact; sensitive files are `0600`, directories `0700`,
  and file reads do not follow unsafe links.
- Every test cleans ports, locks, receipts, temp trees, and child processes in `finally`.
- Preserve primary and cleanup failures as separate redacted facts. Do not infer ownership by parsing
  human error text or expose cookie, JWT, key, email, UUID, or credential-shaped output.

## VERIFY

```bash
node --test tests/supabase-local-guard.test.mjs
corepack pnpm supabase:doctor
corepack pnpm supabase:assert-stopped
```
