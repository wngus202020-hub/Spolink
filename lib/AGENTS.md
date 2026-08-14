# DOMAIN LIBRARY GUIDE

## OVERVIEW

`lib/` contains typed domain behavior between App Router adapters and Supabase/provider APIs.
Keep browser-safe clients, server workflows, repositories, and privileged clients explicit.

## STRUCTURE

| Area | Responsibility |
|------|----------------|
| `api/` | Shared JSON and response helpers |
| `auth/` | Claims, cookies, redirects, recovery, route security, page account state |
| `lessons/` | Public lesson queries, display mapping, schedules and reviews |
| `profile/` | Validation, workflow, route factories, Supabase repository |
| `reservations/` | Create/read/cancel workflows and booking client |
| `payments/` | Prepare/confirm, edge auth, Toss verification, reconciliation |
| `coach-certification/` | Applicant/admin workflows, private certificates, submission and review contracts |
| `supabase/` | Environment parsing, browser/server/service clients, generated DB types |

## LAYERING

- Route adapter: HTTP parsing, same-origin/content-type checks, response headers and status mapping.
- Workflow: discriminated result states, authorization preconditions, domain transitions.
- Repository/RPC: typed persistence only; do not hide policy decisions in ad hoc queries.
- Browser client: same-origin requests without secrets; return typed, user-safe failures.
- Provider adapter: verify external responses before any internal state transition.

Use strict types and exhaustive unions. Parse unknown input at boundaries with Zod or explicit
structural parsers. Do not introduce `any`, non-null assertions, thrown string errors, or duplicated
untyped response shapes.

## SECURITY AND TRANSACTIONS

- Preserve same-origin -> JSON -> parse -> validate -> configured -> claims ordering.
- Cookie-aware clients propagate refreshed `Set-Cookie` headers; mutation responses are no-store.
- `createSupabaseServiceClient()` is server-only and limited to trusted provider workflows.
- Payment confirmation validates reservation, order, amount, and provider response before RPC.
- Reconciliation records provider/internal divergence before cancellation or refund follow-up.
- Cancellation authority, time, refund amount, capacity restoration, notifications, and audit rows
  are computed atomically in SQL, never from client-provided values.
- Configured-but-empty lesson reads stay empty; demo fallback is only for unconfigured mode.
- Coach certification status, reviewer, timestamps, and audit effects are RPC/workflow-owned; do not
  accept them from browser input or direct table writes.
- `coach-certificates` remains private. Validate MIME, magic bytes, size, ownership, and overwrite
  rules before issuing short-lived signed reads to the authorized applicant or active admin.

## CHANGE COUPLING

- Auth/profile changes: update route contracts and `tests/profile-api/` or Auth E2E.
- Reservation/payment changes: align service policy, ERD, API spec, migration/RPC, Node SQL contracts,
  concurrency tests, and live Supabase E2E.
- Coach certification changes: align applicant/admin API contracts, Storage/RLS/RPC tests, and auth
  plus live Supabase E2E coverage.
- `database.types.ts` must reflect migrations; do not hand-invent divergent table or enum names.

## VERIFY

```bash
corepack pnpm test:api
corepack pnpm typecheck
corepack pnpm lint
```

Add the relevant live E2E command for auth, payment, reservation, or Supabase changes.
