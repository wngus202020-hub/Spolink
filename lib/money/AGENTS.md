# Money Domain Guide

`lib/money/` owns money read models and thin route adapters around SQL-owned refund and settlement transitions.

## WHERE TO LOOK

- `contract.ts`: strict Zod schemas for refund results/claims and settlement actions.
- `read-model.ts`: `pending|hold|approved|all` settlement filters and ordered reads.
- `routes.ts`: HTTP boundary; delegates every money mutation to a typed Supabase RPC.
- `app/api/settlements/route.ts`: authenticated settlement list; admin/coach pages apply ownership.
- `app/api/settlements/[settlementId]/approve/route.ts` and `hold/route.ts`: admin mutations.
- `app/api/refunds/[refundId]/claim/route.ts` and `process/route.ts`: trusted Edge worker callbacks.
- `supabase/migrations/20260814170000_add_refund_reconciliation_and_settlements.sql`: schema constraints, locks, RPCs, grants.
- `lib/supabase/database.types.ts`: typed RPC argument and return projection; keep it aligned with migrations.
- `tests/money-operations-contract.test.mjs`: SQL/route boundary contract; `tests/money-operations-concurrency.test.mjs`: live races.
- `supabase/tests/money_operations.test.sql`: pgTAP idempotency, result replay, and invariant cases.

## BOUNDARIES

- Settlement reads use the cookie-aware server client. Admin status changes require same-origin JSON, an authenticated user, and the SQL active-admin check.
- `claim_refund`, `process_refund_result`, and settlement generation routes require `Authorization: Bearer <SPOLINK_EDGE_SECRET>`; validate configured Edge and Supabase service environments first.
- Trusted Edge callbacks use `createSupabaseServiceClient()` only to invoke the narrow RPC. Never expose `SUPABASE_SERVICE_ROLE_KEY` or `SPOLINK_EDGE_SECRET` to browser code.
- Route code does not call Toss. A trusted worker claims/processes a refund and supplies verified provider results; payout execution remains outside this MVP.

## CONTRACTS

- Claim body is strict `{ idempotencyKey }`: trimmed string, 1-200 chars; refund id is UUID.
- Result body is strict `{ action: "complete"|"fail", providerRefundKey?, failureCode?, rawPayload?, claimToken? }`; provider key is trimmed 1-200, failure code trimmed 1-100, raw payload is JSON, and the optional token is UUID.
- Settlement generation body is strict `{ reservationId: UUID }`; hold body is strict `{ reason: trimmed string, 1-500 chars }`.
- `claim_refund` locks the refund row, increments `claim_attempt`, stores the idempotency key, issues a UUID claim token, and expires it after five minutes.
- Same-key claim and identical result fingerprint replay return `idempotent=true`; a live competing claim or mismatched claim token is a conflict. Complete requires a provider refund key; fail requires a failure code.

## STATE OWNERSHIP

- Refund status is `requested|approved|failed|completed`; RPCs/triggers own transitions, refund-total limits, `processed_at`, and payment `partially_refunded|refunded` updates.
- Cancellation creates an internal `refunds.status=requested` record. That record is not proof of a Toss refund; actual Toss execution and provider reconciliation require the trusted Edge path.
- Settlement generation is one row per reservation and requires completed timing, eligible payment/coach, and no pending refund. Local status is only `pending|hold|approved`.
- `set_settlement_status` owns approve/hold, hold reason, approval timestamp, audit row, and idempotent same-decision replay. `paid|failed`, `paid_at`, and payout network execution are deferred.

## ANTI-PATTERNS

- Do not write `refunds` or `settlements` directly to change money state, or accept amount, actor, time, status, or eligibility from clients.
- Do not bypass UUID/schema checks, Edge bearer authentication, service-role isolation, row locks, idempotency keys, claim tokens, or result fingerprints.
- Do not mark a settlement paid, execute Toss/payout from a route, or treat an internal refund request as provider completion.
- Do not validate concurrency with row counts alone; assert winner/loser, token ownership, terminal state, idempotent replay, and exactly one settlement.

## VERIFY

- `corepack pnpm test:api:contracts`: API inventory and money contract coverage.
- `corepack pnpm supabase:test:db`: local Docker Supabase plus pgTAP SQL contracts, including `supabase/tests/money_operations.test.sql`.
- `corepack pnpm test:money-operations:live`: serialized refund claim/result and duplicate settlement concurrency scenario.
- For money changes, also run `corepack pnpm typecheck` and `corepack pnpm lint`.
