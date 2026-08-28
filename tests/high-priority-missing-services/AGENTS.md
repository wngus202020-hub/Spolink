# HIGH-PRIORITY CONTRACTS GUIDE

## SCOPE

This directory is the serial high-priority contract entry and the Task 3 reservation-lifecycle
evidence package. It binds contract, live Supabase, browser, quality, scan, and stopped-cleanup proof.

## ENTRY POINTS

- `run-contracts.mjs` is the ordered high-priority contract inventory.
- `run-task-11.mjs` delegates only to `run-contracts.mjs`; keep it a thin compatibility entry.
- `task3-gate-contracts.mjs` is the exact 11-gate matrix and command/producer/result contract.
- `verify-task3-attempt-evidence.mjs` builds, verifies, and seals an active Task 3 attempt.
- `finalize-task3.mjs` validates sealed receipts before anchored canonical publication.

## TASK 3 GATES

- Required gates: focused-contract, focused-db, real-http, browser-desktop, browser-mobile,
  supabase-aggregate, typecheck, lint, build, evidence-scan, and stopped-cleanup.
- Every receipt names the active attempt, gate command, producer, artifact hash, source binding, and passed verdict.
- Do not add a substitute, skipped, aggregate-only, or hand-written receipt to satisfy a missing gate.

## PRIVATE ATTEMPT RULES

- Attempt directories are exactly mode `0700`; files are exactly mode `0600`.
- Reject symlinks, hardlinks, foreign ownership, traversal, escaped outputs, and non-regular nodes.
- Write only beneath the supplied active attempt; do not use an arbitrary evidence directory or temp alias.
- Enforce exact JSON schemas, sorted manifests, hashes, redaction/secret scans, and contained references.
- Bind receipts to the current HEAD, source manifest hash, and normalized worktree-status hash.
- Revalidate source binding around sealing, replay, and finalization to fail closed on TOCTOU drift.

## PUBLICATION

- Attempts are immutable after sealing; validate rather than patch a sealed attempt.
- Publish only through the anchored directory publisher after all 11 receipts validate.
- Canonical output is `.omo/evidence/high-priority-missing-services/task-3/reservation-lifecycle.json`.
- Canonical publication is derived from a sealed attempt; never edit canonical evidence directly.
- Keep remediation attempt outputs separate from the canonical publication path.

## COMMANDS

```bash
corepack pnpm test:high-priority:contracts
corepack pnpm exec node tests/high-priority-missing-services/run-task-11.mjs
corepack pnpm exec node tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs --attempt <attempt-dir>
corepack pnpm exec node tests/high-priority-missing-services/finalize-task3.mjs --receipts <active-attempt-dir>
```

## REVIEW

- Keep runner order deterministic and Node test concurrency at the declared serial setting.
- Treat a stale source binding, incomplete manifest, unsafe filesystem node, or failed cleanup receipt as failure.
- Evidence writers own modes and atomicity; callers provide facts, not manually edited evidence.
