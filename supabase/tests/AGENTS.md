# SQL Test Guide

`supabase/tests/` contains local PostgreSQL/pgTAP tests for grants, RLS, RPC behavior, and state transitions.

## WHERE TO LOOK

- Root suites: `supabase/tests/*.test.sql`.
- Split-suite example: `supabase/tests/lesson_images.test.sql` plus `supabase/tests/lesson_images/`.
- Auth and grant example: `supabase/tests/auth_recovery_grants.test.sql` plus `auth_recovery_grants/`.
- Reservation fixture and behavior files: `supabase/tests/reservation_cancellation/`.
- Schema/grant assertions live beside behavior assertions; `structure_and_permissions.psql` is the naming pattern.

## TEST SHAPE

- Start root suites with `begin;`; suites that bootstrap pgTAP explicitly use `create extension if not exists pgtap;`.
- Declare either an exact `select plan(N);` or `select no_plan();` before assertions.
- End with `finish()` followed by `rollback;`; existing roots use `select * from finish();` or `select finish();`.
- Included `.psql` files do not own the outer transaction, plan, finish, or rollback.
- Root files include children with `\ir <suite>/<file>.psql`; paths and execution context are anchored by the invoking root test.
- `setup.psql` creates the deterministic fixture and `pg_temp` helpers consumed by later included files.

## FIXTURES AND ACTORS

- Use fixed UUIDs, stable labels, and test-only email domains; make each suite's IDs namespaced by task/suite.
- Prefer `statement_timestamp()` and explicit relative intervals for time-sensitive cases; avoid wall-clock races.
- Use temporary tables with `on commit drop` for per-suite lookup state and RPC results.
- Switch JWT claims with a temporary helper using `set_config('request.jwt.claims', ...)`, `request.jwt.claim.sub`, and `request.jwt.claim.role`.
- Pair every `set local role anon|authenticated|postgres;` with `reset role;`, including inside included files.

## SECURITY CASES

- Test both the intended `authenticated`/`anon` execution path and denied paths with `throws_ok(...)`.
- Exercise RLS through the switched role; do not treat a `postgres` setup write as proof of user access.
- Test RPC behavior, `has_function_privilege(...)`, and `has_table_privilege(...)` where the boundary is part of the contract.
- For system-managed tables, assert direct authenticated `INSERT`/`UPDATE`/`DELETE` denial as well as the allowed RPC result.
- Use `postgres` only for observed service-only setup or provider-result simulations, then restore the role before user assertions.

## ANTI-PATTERNS

- Do not share mutable rows, random fixture IDs, or external provider state between suites.
- Do not put credentials, service-role keys, JWTs, cookies, real PII, or provider secrets in SQL fixtures or comments.
- Do not bypass RLS by testing only as `postgres`, or validate an RPC only through direct table writes.
- Do not leave a role, JWT claim, temporary object, or changed row for a later suite to discover.
- Do not add a standalone `.psql` runner; preserve the root `.test.sql` inclusion context.

## VERIFY

- Start the guarded local runtime, then run `corepack pnpm supabase:test:db`; its verified runner invokes `supabase test db supabase/tests --local`.
- Require a passing TAP plan/finish result for every discovered root suite; a process exit alone is insufficient.
- After the run, use `corepack pnpm supabase:assert-stopped` when the runtime is no longer needed.
