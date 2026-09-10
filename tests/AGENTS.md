# TEST GUIDE

## OVERVIEW

`tests/` combines fast Node contracts, Playwright user flows, SQL-contract harnesses, guarded live
Supabase E2E, lifecycle safety tests, and staging/evidence security gates.

## TEST DOMAINS

| Area | Framework / purpose |
|------|---------------------|
| `*.test.mjs` | `node:test` API, workflow, source, read-model, and migration contracts |
| `profile-api/` | Validation, route precedence, workflow, repository boundaries |
| `auth-ui-e2e/` | Playwright auth and browser commerce flows; see child guide |
| `lesson-images/` | Image route, Storage, idempotency, browser, and evidence suites; see child guide |
| `mypage-profile-edit-docs-contract.test.mjs` | Source/docs contract for the profile-edit screen and Todo7 evidence claims |
| `supabase-e2e/` | Guarded local live Auth, RLS/RPC, Storage, reservation/payment/cancellation races, HTTP/read-state, and evidence; see child guide |
| `high-priority-missing-services/` | High-priority contract runner and Task 3 evidence package; see child guide |
| `supabase-local-guard/` | Process, Docker, receipt, lock, and cleanup safety; see child guide |
| `staging-contract/` | Provider checklist, forbidden commands, redaction contracts |
| `lesson-map-browser-qa.mjs` | Browser map interaction QA with a NAVER Maps SDK stub; not live provider credential or tile proof |
| `fixtures/regions/` | Immutable official region snapshot and checksum |
| `../supabase/tests/` | PostgreSQL/pgTAP permission and transactional behavior suites |

## CONVENTIONS

- Node tests use `node:test` and `node:assert/strict`; names end in `.test.mjs`.
- Playwright user scenarios end in `.spec.ts`; runners use `run-*.mjs`.
- Test observable behavior and persisted state, not only source regex or mocked call counts.
- Keep deterministic fixture IDs/personas/builders and exact snapshot assertions.
- Use existing lifecycle facades; do not spawn unmanaged Supabase, Next, or Docker processes.
- Every owned process, port, config mutation, temp directory, user, and DB graph needs `finally`
  cleanup and a stopped-state assertion.
- Evidence is redacted, schema-checked, mode-restricted, and hash-backed. Never record raw JWTs,
  cookies, authorization headers, keys, emails, UUIDs, DB URLs, or provider bodies.
- Do not weaken a race barrier, expected state, secret scan, or cleanup assertion to remove flakiness.
- Coach certification coverage must include private Storage ownership, upload validation, atomic
  submit/review transitions, idempotency, stale conflicts, and direct mutation denial.

## COMMANDS

```bash
corepack pnpm test:api
corepack pnpm test:api:contracts
corepack pnpm test:api:live
corepack pnpm test:money-operations:live
corepack pnpm test:high-priority:contracts
corepack pnpm test:coach-certification
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:profile-edit
corepack pnpm test:e2e:profile-avatar
corepack pnpm test:e2e:account-settings
corepack pnpm test:e2e:notifications
corepack pnpm test:e2e:reservations
corepack pnpm test:e2e:coach-dashboard
corepack pnpm test:e2e:supabase
corepack pnpm test:e2e:supabase:deps
corepack pnpm test:e2e:supabase:evidence
corepack pnpm staging:contract:test
```

Use the smallest focused runner first. Full Supabase suites require Docker and must finish with
`corepack pnpm supabase:assert-stopped`.

`test:api:contracts` is the deterministic no-runtime contract inventory. `test:api:live` (and the
legacy aggregate name `test:api`) owns guarded local Supabase, a selected loopback Next server, the
17 payment/reservation HTTP boundary tests, and the serial live profile lifecycle.
`test:money-operations:live` owns the guarded local Supabase concurrency scenario separately.
