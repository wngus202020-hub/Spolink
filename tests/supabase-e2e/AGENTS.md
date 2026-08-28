# SUPABASE E2E GUIDE

## OVERVIEW

This directory proves live local Auth/RLS, coach certification, cancellation policy, payment/cancellation races,
deterministic provisioning, bounded cleanup, and evidence integrity.

## ENTRY POINTS

- `run.mjs` delegates the guarded full run to `task8/orchestrator.mjs`.
- `task8/registered-tests.mjs` is the authoritative live-test inventory;
  `task8/orchestrator.mjs` executes it. Register tests there rather than relying on filenames.
- `fixtures.mjs` and `provision.mjs` are facades; extend their existing submodules.
- `verify-dependencies.mjs` compares the current dependency/source manifest with the committed baseline
  and Todo8 change ledger; it is not a generic local-tool or config probe.
- `verify-evidence.mjs` validates requested evidence targets and requires each target's latest attempt to APPROVE.
- `local-status.mjs` reads only sealed, loopback local status.

## FIXTURES

- Preserve deterministic UUID prefixes and the learner/otherLearner/coach/pendingCoach/admin personas.
- Derive time-based rows from the supplied epoch; keep policy slots separate from race slots.
- Validate the normalized profile/lesson/schedule/reservation/payment/refund graph, not row counts only.
- Provision Auth users before relational rows and teardown the owned graph plus generated side effects.
- Never reuse real user data, hosted projects, arbitrary local resources, or unowned credentials.

## CONCURRENCY

- Races use real HTTP/RPC workers synchronized by DB barriers and observed blocker chains.
- Keep settlement-once, worker identity, matched function, wait chain, and timing assertions.
- Final state includes reservation, payment, refund source/count, notification, audit, and
  `reserved_count`.
- Restore each race slot and require side effects to return to zero.
- Adversarial contracts must continue rejecting forged labels, wrong functions, stale observations,
  duplicate settlements, and blocker chains that never reach the locker.

## EVIDENCE AND CLEANUP

- Use exact-schema JSON/append-only JSONL writers and recursive redaction.
- Receipts and sensitive metadata use mode `0600`; evidence directories use mode `0700`.
- Do not store raw keys, JWTs, cookies, authorization, fixture identities, DB URLs, or provider data.
- `live-qa-lock.mjs` serializes live QA ownership; hold mode needs the validated metadata/release protocol.
- `supabase-config-guard.mjs` permits only its explicit TOML delta and final-config baseline assertions.
- The orchestrator owns start, reset, DB tests, QA, stop, and `assert-stopped`; restrict recovery cleanup
  to failures it handled and `SIGINT`/`SIGTERM`, never arbitrary ambient runtime or evidence deletion.
- Keep config deltas allowlisted and restore `supabase/config.toml` before verdict calculation.
- Include coach certification Storage/RLS, submission/review RPC, concurrent decision, and cleanup
  checks in live coverage; never persist raw certificates or signed URLs in evidence.

## RUN

```bash
corepack pnpm test:e2e:supabase:deps
corepack pnpm test:e2e:supabase
corepack pnpm test:e2e:supabase:evidence task-1 task-2 task-3 task-4 task-5 task-6 task-7 task-8
corepack pnpm supabase:assert-stopped
```
