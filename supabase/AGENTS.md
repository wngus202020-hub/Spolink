# SUPABASE GUIDE

## OVERVIEW

`supabase/` is the PostgreSQL authority for schema, grants, RLS, and transactional RPCs. Local
lifecycle remains the full verification surface. The separate hosted staging project is at the
34-migration baseline; local migrations 35-39 are not yet deployed there. Hosted Auth/provider
configuration is managed out of tree and production is not deployed.

## STRUCTURE

```text
supabase/
├── config.toml       # Local project `spolink`, loopback ports, Auth test URLs
├── migrations/       # Ordered schema/RLS/RPC changes; read child guide
├── tests/            # SQL/psql permission and behavior tests; read child guide
└── snippets/         # Reserved reference-SQL directory; currently empty
```

## MIGRATION RULES

- Add forward migrations; do not rewrite an applied migration merely to simplify history.
- Keep enums, table names, grants, RLS, and state transitions aligned with `SPOLINK_ERD.md` and
  `SPOLINK_API_명세서.md`.
- Ordinary authenticated users receive only explicitly required RPC grants.
- `confirm_paid_reservation`, `mark_payment_confirmation_failed`, and
  `mark_payment_confirmation_reconciliation_required` remain `service_role` only.
- Cancellation locks reservation/payment/schedule rows and computes actor, timing, integer refund,
  capacity restoration, notification, and audit inside one transaction.
- Automatic refund sources are unique per reservation. Only an identical actor/reason retry returns
  the prior result; conflicting retries fail with `23505`.
- Refund policy is 70% at least 24 hours before, 50% from 3 to under 24 hours, and 0% under 3 hours;
  integer arithmetic discards fractional currency.
- Internal `refunds.status = requested` is not proof of an actual Toss provider refund.
- Migration 35 exposes review history only to its review owner (and authorized admins), never other users.
- Migration 36 keeps Realtime notifications owner-scoped; Web Push subscriptions and delivery outbox rows
  remain owner-protected, while queue lease/complete/retry operations are service-role only.
- Migration 37 treats geocoded latitude and longitude as a paired location: both valid coordinates or both null.
- Migration 38 makes profile-avatar reads public, but insert/update/delete paths owner-mutated and path-bound.
- Migration 39 `withdraw_current_account()` accepts no owner input, soft-deletes only `auth.uid()`, clears
  personal settings, and preserves financial/history rows required by policy.
- RLS must protect ownership and system-managed fields even when API validation exists.

## LOCAL CONFIG

- Keep `project_id = "spolink"`; guarded lifecycle/status validation, not TOML network restrictions,
  enforces loopback-only local endpoints.
- Do not commit signing keys, service-role keys, database credentials, or provider secrets.
- Auth redirect URLs used by E2E are exact loopback URLs and are restored by the runner.
- Use guarded package scripts, not raw destructive Supabase CLI commands.
- Hosted staging link metadata is local-only and may be removed after provider work so it cannot
  conflict with guarded local lifecycle ownership. Never run linked reset/down/include-seed commands.

## VERIFY

```bash
corepack pnpm supabase:start
corepack pnpm supabase:reset
corepack pnpm supabase:test:db
corepack pnpm test:e2e:supabase
corepack pnpm supabase:stop
corepack pnpm supabase:assert-stopped
```

Reservation/payment migrations also require the matching Node SQL-contract and concurrency tests.
