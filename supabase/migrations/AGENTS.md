# MIGRATION GUIDE

## OVERVIEW

`migrations/` is the ordered authority for schema, RLS, grants, and transactional RPC behavior.

## ORDERING AND OWNERSHIP

- Add a new timestamped migration; never rewrite an applied migration or the historical MVP base.
- Treat the newest corrective migration as current behavior while preserving its predecessor chain.
- Keep `SPOLINK_ERD.md`, `SPOLINK_API_명세서.md`, and `lib/supabase/database.types.ts`
  synchronized with changed tables, enums, views, and RPC signatures.
- Use stable schema-qualified names. Replacement functions must restate the intended signature,
  owner, `revoke`, and least-privilege `grant execute` contract.

## SECURITY AND TRANSACTIONS

- `security definer` functions set an explicit safe `search_path` and authorize from verified
  `auth.uid()`/profile state before touching privileged rows.
- Deny direct writes to system-managed status, actor, timestamp, amount, audit, and delivery fields.
- Lock rows in a deterministic order before checking state or calculating money/capacity effects.
- Keep transition, idempotency, audit, notification, capacity, refund, and settlement effects in one
  transaction; application code must not reconstruct partial behavior.
- Preserve documented SQLSTATE and result-row mappings consumed by typed route/workflow adapters.
- RLS remains required even when a route validates ownership or uses a narrowly scoped RPC.

## HIGH-RISK CHANGES

- Reservation cancellation computes actor, database time, integer refund, and capacity restoration.
- Payment confirmation, refund processing, and settlement generation keep provider and internal
  state divergence observable for reconciliation.
- Coach certification and lesson-image transitions pair status changes with private Storage/RLS
  ownership and exactly-once side effects.
- Owner review history is visible only to the review owner and admins; never relax review RLS for discovery.
- Realtime notifications stay owner-scoped; Web Push subscriptions/outbox delivery are RLS-protected and
  service-role-only workers lease, complete, or retry delivery rows.
- Geocoded lesson locations store latitude/longitude as a validated pair, never one coordinate alone.
- Profile-avatar objects are publicly readable but only their authenticated owner may mutate the bound path.
- Account withdrawal derives the actor from `auth.uid()`, removes personal settings, and soft-deletes while
  retaining financial and policy-required history.
- Actual Toss refund execution and payout remain outside these local migrations.

## VERIFY

```bash
corepack pnpm supabase:reset
corepack pnpm supabase:test:db
corepack pnpm test:api:contracts
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```

Add the focused Node SQL-contract and race test for the changed RPC; a passing reset alone is not
transition coverage.
