# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-07
**Commit:** 07d67f2 (working tree snapshot includes uncommitted files)
**Branch:** main

## OVERVIEW

SPOLINK is a Korean sports lesson marketplace built with Next.js 16, React 19,
TypeScript, Tailwind CSS v4, and a Supabase-backed MVP. The current runnable surface includes
lesson discovery/authoring/maps, auth and recovery, profile onboarding/editing/avatar/account,
booking and payment, reservation lifecycle/completion/calendar, favorites, reviews,
notifications, trust-safety, coach certification, money states, and admin/coach operations.

Root Markdown files define product policy and contracts. `app/`, `components/`, `lib/`,
`scripts/`, `supabase/`, and `tests/` are the implementation and verification surface.

## STRUCTURE

```text
spolink/
├── app/                 # App Router pages and thin HTTP route adapters
├── components/          # Client interactions and reusable visual components
├── lib/                 # Typed domain workflows, repositories, and provider boundaries
├── scripts/             # Guarded local lifecycle and deterministic generators
├── supabase/            # Local config, migrations, RLS/RPCs, SQL tests
├── tests/               # Node contracts, Playwright flows, live Supabase E2E
├── public/              # Deployable lesson media plus the Web Push service worker
├── SPOLINK_*.md         # Product, policy, ERD, API, screen, design, and brand sources
├── proxy.ts             # Root Next request/session boundary
└── package.json         # Corepack pnpm commands
```

Read the nearest child `AGENTS.md` before changing files in these areas: `app/`,
`components/`, `lib/`, `scripts/`, `supabase/`, and `tests/`.

## WHERE TO LOOK

| Task | Location | Source of truth |
|------|----------|-----------------|
| Service and refund rules | `SPOLINK_서비스_정책서.md` | Roles, booking, refund, no-show, settlement |
| Tables, enums, RLS, RPCs | `SPOLINK_ERD.md`, `supabase/migrations/` | Data and authorization model |
| HTTP contracts | `SPOLINK_API_명세서.md`, `app/api/` | Permissions, payloads, state transitions |
| Routes and UI states | `SPOLINK_화면_설계.md`, `app/` | User journeys and implemented screens |
| Tokens and accessibility | `DESIGN.md`, `SPOLINK_디자인_시스템.md`, `app/globals.css` | Canonical visual language |
| Brand copy | `SPOLINK_Brand_Identity_v1.0.md` | Trust, Nearby, Community, Growth, Simplicity |
| Local backend lifecycle | `scripts/supabase-local.mjs` | Guarded Docker/Supabase ownership |
| Test entry points | `package.json`, `tests/` | Contract, browser, DB, and evidence suites |

For conflicts, migrations/RLS/RPCs and typed workflows govern transactions; policy governs intent.
Screen/design docs are projections; development-structure and improvement-plan docs are historical.

## CODE MAP

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|-----:|------|
| `HomePage` | page | `app/page.tsx` | - | Public discovery and auth-aware entry |
| `readPageAuthProfile` | auth boundary | `lib/auth/page-auth.ts` | 41 | Shared page account-state redirects |
| `proxy` | request boundary | `proxy.ts` | 1 | Global Supabase session refresh entry |
| `runCreateReservationWorkflow` | workflow | `lib/reservations/create-reservation-api.ts` | 3 | Pending reservation RPC boundary |
| `createCancelReservationRouteAdapter` | route factory | `lib/reservations/cancel-reservation-route-adapter.ts` | - | Atomic cancellation entry |
| `runConfirmPaymentWorkflow` | workflow | `lib/payments/confirm-payment-api.ts` | - | Toss verification and reconciliation |
| `createSupabaseServerClient` | infrastructure | `lib/supabase/server.ts` | 30 | Cookie-aware request client |
| `createSupabaseServiceClient` | infrastructure | `lib/supabase/server.ts` | 14 | Server-only privileged client |

## CURRENT BOUNDARY

- Backend confidence includes guarded local Supabase Auth/PostgreSQL/RLS/RPC/API/E2E plus hosted
  staging readiness, signup, and cross-user RLS smoke checks; it is not production confidence.
- Authenticated account settings/soft withdrawal, favorites, reviews, in-app notifications,
  trust-safety, lesson authoring, reservation completion/calendar, internal refund reconciliation,
  and settlement states exist.
- Local notifications include authenticated Realtime catch-up, owner-scoped Web Push subscriptions,
  a transactional delivery outbox, lease/retry RPCs, and a trusted provider worker route. Hosted
  migration deployment, worker scheduling, and live external Push Service delivery remain pending.
- A separate Hosted Supabase staging project and logical-staging Vercel project are deployed through
  the 34-migration baseline. Local migrations 35-39 add owner review history, Realtime/Web Push,
  geocoded lesson coordinates, profile avatar Storage, and account withdrawal; their hosted
  deployment is pending. NAVER address geocoding and coordinate-backed list/map discovery are
  implemented; live provider tiles require application credentials, while current-location
  distance sorting and bounds search remain deferred.
  Mailtrap-backed SMTP confirmation/recovery E2E is verified; CI/CD, production, actual Toss refund
  execution, payout, and chat remain deferred.
- Coach certification upload, submission, admin review, and private signed certificate reads are
  covered by local E2E; their schema and Storage policies are deployed to staging, while hosted
  applicant/admin browser E2E and full payout-account storage remain deferred.
- Internal cancellation creates a refund request. Provider refund execution belongs to a later
  trusted Edge boundary.

## CONVENTIONS

- Use Korean product terminology and preserve `SPOLINK` casing in product prose.
- Use `coach` in code/DB identifiers but `지도자` in user-facing Korean copy.
- Use `corepack pnpm`; the repository is pinned to `pnpm@10.25.0`.
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Biome uses 2 spaces, 100 columns, double quotes, and semicolons only as needed.
- Keep Route Handlers thin: parse and authorize at the boundary, then call typed `lib/` workflows.
- Keep service policy, ERD, API, screen, and UI documents aligned when transactional states change.
- UI uses semantic CSS variables from `app/globals.css` and Lucide icons.
- `pnpm dev` intentionally uses Webpack; `.codegraph` is a cache symlink that Turbopack may follow.

## ANTI-PATTERNS

- Do not expose service-role keys, Toss secrets, cookies, JWTs, fixture identities, or raw PII.
- Do not accept refund amount, cancellation actor, or cancellation time from client input.
- Do not bypass same-origin, JSON content type, schema validation, claims, or `private, no-store`
  checks on mutations.
- Do not move payment confirmation/refund/settlement writes to anonymous or ordinary client paths.
- Do not describe deferred providers as implemented or add provider parameters without checking
  current official documentation.
- Do not add raw hex colors, arbitrary typography/spacing, a second icon family, or default
  shadcn styling outside the design system.
- Do not treat `.omo/`, `.playwright-mcp/`, `.next/`, `.codegraph/`, or `node_modules/` as source.

## COMMANDS

```bash
corepack pnpm dev                 # http://127.0.0.1:3000
corepack pnpm dev:local           # local Supabase + http://127.0.0.1:3000
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:api:contracts
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:notifications
corepack pnpm test:e2e:reservations
corepack pnpm supabase:doctor
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
corepack pnpm staging:contract:test
```

`dev:local` requires the fixed `127.0.0.1:3000` port. A fresh guarded Supabase runtime stops with
the launcher; a reused runtime must be stopped explicitly with `supabase:stop`, followed by
`supabase:assert-stopped`.

`corepack pnpm format` writes files. Supabase suites require Docker and own their lifecycle. These
commands through `supabase:assert-stopped` describe local development only. `staging:contract:test`
checks deployment policy locally; it does not mutate hosted Supabase, Vercel, or production.

## NOTES

- This is a Git worktree on `main` and is often intentionally dirty; never reset unrelated changes.
- A separate hosted staging deployment exists. There is no production deployment or CI workflow.
- `next-env.d.ts` and `lib/lesson-regions.ts` are generated. `public/` is deployable source, not output.
- The highest-risk changes span reservation, payment, cancellation, refund, settlement, coach
  certification review, and eligibility. Verify the complete chain, not only the touched UI or route.
- Coach certification changes must cover applicant draft/certificate storage, atomic submission,
  admin approve/reject side effects, private signed reads, and desktop/mobile evidence.
