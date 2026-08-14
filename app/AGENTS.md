# APP ROUTER GUIDE

## OVERVIEW

`app/` owns URL structure, Server Component composition, redirects, and thin HTTP adapters.
Domain rules live in `lib/`; interactive state lives in `components/`.

## STRUCTURE

```text
app/
├── api/             # Lessons, profiles, reservations, and payments Route Handlers
├── auth/            # Login, signup, callback, recovery, logout, restricted account flows
├── lessons/         # Discovery, detail, and booking pages
├── mypage/          # Profile, favorites, and reservation reads
├── onboarding/      # Required profile completion
└── reservations/    # Payment page
```

## ROUTE RULES

- Pages are Server Components unless browser state or events require a child client component.
- Next 16 dynamic `params` and `searchParams` are promises; type and `await` them.
- Cookie/auth-dependent pages use `dynamic = "force-dynamic"` and `revalidate = 0`.
- Public pages still call `readPageAuthProfile()` to render account-aware navigation.
- Protected pages resolve states in this order: unauthenticated/unconfigured to login with a safe
  `next`, `profile_required` to onboarding, suspended/deleted through `readPageAuthProfile()`.
- Preserve query filters and KST date behavior when linking between discovery and detail surfaces.

## API BOUNDARIES

- Route files adapt `Request`/`NextResponse`; workflow and repository logic belongs in `lib/`.
- Mutation order is same-origin, JSON content type, JSON parse, typed validation, configured state,
  authenticated claims, then workflow.
- Mutation responses, including errors, remain `Cache-Control: private, no-store`.
- Ordinary routes use cookie-aware anon clients. Service-role clients are limited to trusted
  payment confirmation/reconciliation boundaries.
- Keep public lesson GET routes filtered to active lessons and allowed public fields.

## ANTI-PATTERNS

- Do not duplicate RLS or refund policy in page components.
- Do not import server-only Supabase modules into client components.
- Do not add middleware/proxy/loading/error conventions speculatively; none are current route-tree
  patterns. The root `proxy.ts` is the existing request boundary.
- Do not turn coach guidance or favorite reads into provider mutations without updating contracts.
- Coach applicant/admin routes must derive role, reviewer, status, and transition timestamps on the
  server; clients may submit form data but never authoritative certification state.

## VERIFY

```bash
corepack pnpm test:api
corepack pnpm typecheck
corepack pnpm test:e2e:auth
```
