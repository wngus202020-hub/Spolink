# TEST GUIDE

## OVERVIEW

`tests/` combines fast Node contracts, Playwright user flows, SQL-contract harnesses, guarded live
Supabase E2E, lifecycle safety tests, and staging/evidence security gates.

## TEST DOMAINS

| Area | Framework / purpose |
|------|---------------------|
| `*.test.mjs` | `node:test` API, workflow, source, read-model, and SQL contracts |
| `profile-api/` | Validation, route precedence, workflow, repository boundaries |
| `auth-ui-e2e/` | Playwright auth and browser commerce flows; see child guide |
| `supabase-e2e/` | Live Auth/RLS/cancellation/concurrency/evidence; see child guide |
| `supabase-local-guard/` | Process, Docker, receipt, lock, and cleanup safety |
| `staging-contract/` | Provider checklist, forbidden commands, redaction contracts |
| `fixtures/regions/` | Immutable official region snapshot and checksum |

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
corepack pnpm test:coach-certification
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:reservations
corepack pnpm test:e2e:supabase
corepack pnpm test:e2e:supabase:deps
corepack pnpm test:e2e:supabase:evidence
corepack pnpm staging:contract:test
```

Use the smallest focused runner first. Full Supabase suites require Docker and must finish with
`corepack pnpm supabase:assert-stopped`.
