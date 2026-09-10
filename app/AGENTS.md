# APP ROUTER GUIDE

## OVERVIEW

`app/` owns URL structure, Server Component composition, redirects, and thin HTTP adapters.
Domain rules live in `lib/`; interactive state lives in `components/`.

## STRUCTURE

```text
app/
├── admin/           # Back-office coach, lesson, report, reservation, settlement operations
├── api/             # Public/private reads and workflow Route Handlers
├── auth/            # Login, signup, callback, recovery, logout; read `auth/AGENTS.md`
├── coach/           # Certification application plus approved-coach operations
├── lessons/         # Discovery, detail, map/coordinate-backed results, and booking pages
├── mypage/          # Authenticated member journeys; read `mypage/AGENTS.md`
├── onboarding/      # Required profile completion
└── reservations/    # Payment and confirmed-and-paid completion; read its child guide
```

## ROUTE RULES

- Pages are Server Components unless browser state or events require a child client component.
- Next 16 dynamic `params` and `searchParams` are promises; type and `await` them.
- Cookie/auth-dependent pages use `dynamic = "force-dynamic"` and `revalidate = 0`.
- `readPageAuthProfile()` is the common page boundary: it redirects suspended/deleted accounts;
  callers redirect unauthenticated/unconfigured users with a safe `next` and profile-required
  users to onboarding.
- `/mypage/profile` uses `readPageAuthProfile()` once for its Server Component initial data,
  redirects anonymous/unconfigured users to `/auth/login?next=/mypage/profile`, redirects
  profile-required users to `/onboarding/profile`, and leaves suspended/deleted handling to the
  shared restricted-account boundary.
- `readApprovedCoachPage(nextPath)` adds the approved `coach_profiles` plus profile-status check
  for lesson authoring, coach reservations, and settlements. Applicant pages instead use the common
  page boundary and route non-approved users through `/coach/apply` or `/coach/apply/status`.
- Admin pages make an active-admin server check: authenticated, profile-ready, `role === "admin"`,
  and `status === "active"`; otherwise redirect to login, onboarding, restricted, or `/mypage`.
- Recheck resource ownership and current domain state in the server workflow/read boundary; a page
  guard or client-visible status never authorizes a lesson edit, reservation transition, certificate
  read, payment, completion, or calendar download.
- Preserve query filters and KST date behavior when linking between discovery and detail surfaces.

## LOCAL UI STATES

- Keep route-local `loading.tsx` and `error.tsx` beside the affected segment where the tree already
  uses them: admin lesson/report/reservation/settlement and coach lesson/reservation/settlement
  surfaces, coach application status, and `/mypage/profile`.
- Loading UI names the operational read and exposes an appropriate busy/status signal. Error UI is a
  client boundary with Korean recovery copy and its supplied `reset`; preserve local visual tokens.

## API BOUNDARIES

- Route files adapt `Request`/`NextResponse`; workflow and repository logic belongs in `lib/`.
- API taxonomy and endpoint-specific guards are documented in `app/api/AGENTS.md`.
- Keep public lesson GET routes filtered to active lessons and allowed public fields.

## ANTI-PATTERNS

- Do not duplicate RLS or refund policy in page components.
- Do not import server-only Supabase modules into client components.
- Do not move or generalize existing segment-local loading/error boundaries; the root `proxy.ts`
  remains the request boundary.
- Do not turn coach guidance or favorite reads into provider mutations without updating contracts.
- Coach applicant/admin routes must derive role, reviewer, status, and transition timestamps on the
  server; clients may submit form data but never authoritative certification state.

## VERIFY

```bash
corepack pnpm test:api
corepack pnpm typecheck
corepack pnpm test:e2e:auth
```
