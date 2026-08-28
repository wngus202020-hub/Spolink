# TRUST-SAFETY DOMAIN GUIDE

`lib/trust-safety/` owns report/block submission, owner-scoped reads, and active-admin report resolution.

## WHERE TO LOOK

- `contract.ts`: strict Zod body/query schemas; server-owned actor fields are intentionally absent.
- `route-handlers.ts` and `admin-route-handlers.ts`: HTTP boundary, status mapping, and dependency wiring.
- `workflow.ts`: access gates and repository-result to HTTP-result translation.
- `repository.ts`, `default-dependencies.ts`, and `client.ts`: RLS reads, typed RPC calls, and cookie propagation.
- `app/api/reports/route.ts` and `app/api/blocks/route.ts`: user GET/POST adapters.
- `app/api/admin/reports/route.ts`, `[reportId]/route.ts`, and `[reportId]/resolve/route.ts`: admin queue, detail, and resolution.
- `supabase/migrations/20260814100000_add_trust_safety_workflows.sql`: target eligibility and `create_report`, `create_block`, `resolve_report` RPCs.
- `supabase/migrations/20260814000000_freeze_shared_transition_contracts.sql`: direct-write revokes and shared notification contracts.

## DOMAIN CONVENTIONS

- Mutation order is same-origin, JSON content type, body/path parsing, Supabase configuration, then claims/profile access.
- `auth.uid()` supplies reporter, blocker, and reviewer identity inside RPCs; never accept those fields from browser input.
- Report reads are reporter-owned unless the workflow has active admin access; block reads are blocker-owned.
- `can_report_target` resolves target ownership server-side: user/coach requires a commerce relationship; lesson/review/reservation rules remain in the RPC.
- Reject self-blocks and unavailable, deleted, suspended, foreign, or otherwise unauthorized targets through workflow/RPC errors.
- `resolve_report` is active-admin-only; `start_review` requires `submitted`, while `resolve`/`reject` require `reviewing`.
- Status, reviewer, moderation target updates, audit rows, and terminal reporter notifications are RPC-owned and atomic.
- The resolution RPC locks the report with `FOR UPDATE`; its audit payload stays redacted and excludes report detail, reason, and PII.
- Exact resolution replay returns `200` with `idempotent: true`; concurrent or stale state returns `409` rather than applying side effects twice.
- Block replay returns `200` with `idempotent: true`; first creation returns `201`.
- Open-report uniqueness maps `23505` to `DUPLICATE_REPORT`/`409`; `P0001` is conflict, `P0002` not found, `22023` validation, and `42501` forbidden.
- Unknown repository/RPC errors are reduced to `INTERNAL_ERROR`; do not expose raw Postgres messages.

## ANTI-PATTERNS

- Do not insert, update, or delete `reports`, `blocks`, `audit_logs`, or notifications from a browser/table client.
- Do not add a direct admin report update path; resolution must call `resolve_report` so status, audit, moderation, and notification effects stay coupled.
- Do not derive target user, ownership, reviewer, timestamps, moderation state, or notification data from request payloads.
- Do not turn a `409` replay/conflict into a generic success, retry a stale decision with changed inputs, or bypass the row lock.
- Do not broaden report visibility from reporter/admin RLS or expose raw target/user details in response or evidence data.

## VERIFY

- `node --test tests/trust-safety.test.mjs tests/admin-report-open-filter.test.mjs`: schemas, access ordering, mappings, RPC ownership, and admin filters.
- `corepack pnpm test:high-priority:contracts`: includes the trust-safety migration/route contract in the high-priority set.
- `node tests/auth-ui-e2e/run-trust-safety.mjs`: guarded live flow for malformed/foreign targets, duplicate report, block replay, admin resolution, stale conflict, and side-effect counts.
- The live flow must show `200/201/409/422/403` outcomes, `idempotent` replay markers, one resolution notification, and expected audit count; finish with `corepack pnpm supabase:assert-stopped`.
