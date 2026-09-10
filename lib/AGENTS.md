# DOMAIN LIBRARY GUIDE

## OVERVIEW

`lib/` holds typed domain behavior between App Router adapters and Supabase or provider APIs.
Make browser-safe clients, request-bound workflows, repositories, and privileged clients explicit.

## STRUCTURE

| Area | Responsibility |
|---|---|
| `account/`, `auth/`, `profile/` | Session-owned account, claims, redirects, profile contracts |
| `favorites/`, `reviews/`, `notifications/`, `trust-safety/` | Owner/admin-scoped social and safety workflows |
| `lessons/`, `maps/` | Lesson authoring/discovery and NAVER geocoding/map boundaries |
| `reservations/`, `payments/`, `money/` | Booking, provider confirmation, refunds, reconciliation, settlements |
| `coach-certification/` | Applicant and administrator certification workflows |
| `storage/` | Storage validation and object lifecycles; read `storage/AGENTS.md` |
| `supabase/` | Env, typed clients, DB projection, cookie boundary; read `supabase/AGENTS.md` |
| `api/` | Shared JSON and response helpers |

Read the nearest child `AGENTS.md` before changing a listed domain.

## LAYERING

- Route adapters parse HTTP, enforce same-origin and content type, authorize, and map typed results.
- Workflows own preconditions and domain transitions through discriminated result states.
- Repositories and RPC adapters perform typed persistence; do not bury policy in ad hoc queries.
- Browser clients make same-origin, secret-free requests and expose user-safe typed failures.
- Provider adapters verify external responses before an internal state transition.
- Parse unknown input at boundaries with Zod or structural parsers. Preserve strict types and exhaustive
  unions; do not introduce `any`, non-null assertions, thrown strings, or duplicate untyped responses.

## CROSS-DOMAIN SECURITY

- Preserve same-origin -> JSON -> parse -> validate -> configured -> claims ordering. Mutation responses
  are `private, no-store`.
- Request-bound Supabase clients must propagate every refreshed `Set-Cookie`; retain the supplied response
  headers on success and error paths.
- `createSupabaseServiceClient()` is server-only and limited to trusted provider/admin work or narrowly
  scoped enrichment after ownership or a safe public relation is established.
- Compute cancellation authority, time, refund amount, capacity restoration, notifications, and audit rows
  atomically in SQL, never from client input.
- Payment confirmation verifies reservation, order, amount, and provider response before RPC;
  reconciliation records divergence before follow-up.
- Account withdrawal derives the owner from verified claims and keeps cleanup/audit effects in its RPC.
- Coach certification status, reviewer, timestamps, and audit effects are workflow/RPC-owned.
- `coach-certificates` is private: the applicant owner reads directly through the current Storage `SELECT`
  policy; only an active admin receives a 300-second signed read. Never describe applicant reads as signed.

## CHANGE COUPLING

- Auth/profile: align route contracts and matching profile or auth E2E coverage.
- Reservation/payment/money: align policy, ERD, API, migrations/RPCs, concurrency, audit/notification, and
  live Supabase E2E.
- Visibility domains: align owner/admin access, RLS/RPC, route contracts, and matching Node/browser tests.
- Storage and certification: align bucket policies, validation, authorization, cleanup, workflows, and
  Storage/RLS plus live E2E coverage.
- Update `database.types.ts` with migration/RPC contracts; it must match, not invent, database schema.

## VERIFY

```bash
corepack pnpm test:api
corepack pnpm typecheck
corepack pnpm lint
```

Run the relevant live auth, payment, reservation, or Supabase E2E lane for the changed workflow.
