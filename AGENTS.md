# PROJECT KNOWLEDGE BASE

**Generated:** 2026-08-14
**Commit:** not a git repository
**Branch:** not a git repository

## OVERVIEW

SPOLINK is a Korean sports lesson marketplace built with Next.js 16, React 19,
TypeScript, Tailwind CSS v4, and a local Supabase MVP backend. The current runnable
surface includes lesson discovery, auth and recovery, profile onboarding, booking,
coach certification application/review, payment preparation/confirmation contracts,
reservation history/cancellation, and My Page reads.

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
├── public/images/       # Lesson media assets
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
| Tokens and accessibility | `SPOLINK_디자인_시스템.md`, `app/globals.css` | Canonical visual language |
| Brand copy | `SPOLINK_Brand_Identity_v1.0.md` | Trust, Nearby, Community, Growth, Simplicity |
| Local backend lifecycle | `scripts/supabase-local.mjs` | Guarded Docker/Supabase ownership |
| Test entry points | `package.json`, `tests/` | Contract, browser, DB, and evidence suites |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `RootLayout` | layout | `app/layout.tsx` | Korean metadata and global shell |
| `HomePage` | page | `app/page.tsx` | Public discovery entry |
| `LessonsPage` | page | `app/lessons/page.tsx` | Region, sport, and KST date search |
| `readPageAuthProfile` | auth boundary | `lib/auth/page-auth.ts` | Shared page account-state redirects |
| `PublicHeader` | layout component | `components/layout/public-header.tsx` | Public/authenticated navigation |
| `LessonSearchPicker` | client component | `components/lessons/lesson-search-picker.tsx` | Desktop controls and mobile dialog state |
| `createGetCurrentProfileRouteHandler` | route factory | `lib/profile/route-handlers.ts` | Profile HTTP security and validation |
| `runCreateReservationWorkflow` | workflow | `lib/reservations/create-reservation-api.ts` | Pending reservation RPC boundary |
| `handleCancelReservation` | route adapter | `lib/reservations/cancel-reservation-route-adapter.ts` | Atomic cancellation entry |
| `runConfirmPaymentWorkflow` | workflow | `lib/payments/confirm-payment-api.ts` | Toss verification and reconciliation |
| `createSupabaseServerClient` | infrastructure | `lib/supabase/server.ts` | Cookie-aware and service-role clients |
| `run` | E2E orchestrator | `tests/supabase-e2e/run.mjs` | Guarded live Supabase verification |

## CURRENT BOUNDARY

- Backend confidence is local-only Supabase Auth/PostgreSQL/RLS/RPC/API/E2E.
- Hosted Supabase, production deployment, actual Toss refund execution, maps, chat, push,
  and public favorite mutation remain deferred.
- Coach certification upload, submission, admin review, and private signed certificate reads are
  implemented against local Supabase; full payout-account storage remains deferred.
- Internal cancellation creates a refund request. Provider refund execution belongs to a later
  trusted Edge boundary.
- Sport Mate and Activity Record remain Phase 2; lesson commerce is the MVP center.

## CONVENTIONS

- Use Korean product terminology and preserve `SPOLINK` casing in product prose.
- Use `corepack pnpm`; the repository is pinned to `pnpm@10.25.0`.
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Biome uses 2 spaces, 100 columns, double quotes, and omitted semicolons.
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
- Do not treat `.omo/evidence/`, `.playwright-mcp/`, `.next/`, or `.codegraph/` as source.

## COMMANDS

```bash
corepack pnpm install
corepack pnpm dev                 # http://127.0.0.1:3000
corepack pnpm dev:local           # local Supabase + http://127.0.0.1:3000
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:api
corepack pnpm test:api:contracts
corepack pnpm test:coach-certification
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:reservations
corepack pnpm supabase:doctor
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```

`corepack pnpm dev:local` is the local-auth development entrypoint. It requires the fixed
`127.0.0.1:3000` port and exits with an error instead of selecting another port when 3000 is
occupied. If it starts a fresh guarded Supabase runtime, stopping the launcher also stops that
runtime. If it reuses an already-valid guarded Supabase runtime, stopping the launcher frees only
port 3000; finish that runtime explicitly with `corepack pnpm supabase:stop` and then
`corepack pnpm supabase:assert-stopped`.

`corepack pnpm format` writes files. Supabase suites require Docker and own their lifecycle. These
commands describe local development only; they do not configure hosted Supabase or production.

## NOTES

- This directory has no Git metadata, hosted deployment, or CI workflow.
- `next-env.d.ts` is generated; avoid incidental changes.
- The highest-risk changes span reservation, payment, cancellation, refund, settlement, coach
  certification review, and eligibility. Verify the complete chain, not only the touched UI or route.
- Coach certification changes must cover applicant draft/certificate storage, atomic submission,
  admin approve/reject side effects, private signed reads, and desktop/mobile evidence.
