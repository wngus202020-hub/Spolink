# ACCOUNT DOMAIN GUIDE

## OVERVIEW

`lib/account/` owns authenticated soft withdrawal, profile-media cleanup, session termination,
and safe HTTP result mapping. The database RPC owns irreversible account-state changes.

## WHERE TO LOOK

| Concern | File |
|---|---|
| Confirmation schema and workflow | `withdrawal.ts` |
| Same-origin DELETE route factory | `route-handler.ts` |
| Claims, avatar cleanup, RPC, sign-out | `default-dependencies.ts` |
| Database transaction | `supabase/migrations/20260904100000_add_account_withdrawal.sql` |
| UI | `components/account/account-deletion-panel.tsx` |

## INVARIANTS

- Accept only `{ "confirmation": "탈퇴하기" }`; reject extra fields before authentication work.
- Derive the account from verified `getClaims()` and `auth.uid()`. Never accept an owner ID.
- Remove an existing `profile-avatars` object before the withdrawal RPC. A cleanup failure stops the
  mutation with `ACCOUNT_CLEANUP_FAILED`; do not leave orphaned personal media intentionally.
- `withdraw_current_account()` owns profile status, deletion time, personal/settings cleanup, audit,
  and preservation of policy-required financial/history rows.
- On success, sign out the local Supabase session and clear Supabase plus auth-flow cookies.
- Keep DELETE same-origin, JSON-only, and `private, no-store` through shared response helpers.

## ANTI-PATTERNS

- Do not hard-delete `auth.users`, financial rows, reservations, reviews, or audit history here.
- Do not let the browser choose deletion time, account state, cleanup fields, or idempotency.
- Do not continue to the RPC when avatar removal fails or expose raw Supabase errors.

## VERIFY

```bash
node --test tests/account-withdrawal.test.mjs
corepack pnpm test:e2e:account-settings
corepack pnpm test:api:contracts
```
