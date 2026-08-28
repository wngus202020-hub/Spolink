# API ROUTE GUIDE

## OVERVIEW
`app/api/` contains thin Next Route Handlers. They authenticate and validate requests, then delegate policy and persistence to typed `lib/` workflows/RPCs.

## ROUTE TAXONOMY

- Public reads: discovery/configuration GETs expose only active, explicitly public fields; validate
  query contracts without requiring a session.
- Authenticated reads: use the cookie-aware server client and claims, then filter by the current
  owner or permitted role. This includes profile, favorites, notifications, and private data reads.
- Ordinary JSON mutations: browser requests for profile, lesson, favorite, review, report,
  reservation, certification, and money actions. Apply the request order below.
- Admin routes: require an authenticated active-admin server check and recheck the target's current
  state in the typed workflow; approval/rejection, moderation, reservation, and settlement actions
  never trust a client-supplied actor or transition state.
- Trusted Edge/service-role routes: provider/reconciliation boundaries authenticate the trusted
  caller before privileged work. Service-role scope also supports tightly scoped private certificate
  reads; it never becomes a general browser-data client.
- Private calendar GET: owner-only, completion-state-checked ICS download; it is not an ordinary
  JSON mutation.

## ORDINARY JSON MUTATION ORDER

1. Check same-origin plus method and JSON content type.
2. Parse JSON and validate the domain schema.
3. Check configured state and authenticated `getClaims()` identity.
4. Recheck authorization, ownership, and domain state.
5. Invoke the typed workflow; return its mapped result with `Cache-Control: private, no-store`.

Trusted and special routes must implement their own required authentication, authorization,
state, and caching behavior. Do not assume every existing trusted route shares this exact order or
identical response headers.

## COACH CERTIFICATION
Applicant/admin routes never accept profile status, reviewer, review timestamps, or ownership identifiers from clients. Applicant draft writes and submit use the approved workflow/RPC; admin decisions require active-admin claims and server-side transaction checks.

## SECURITY
- Use cookie-aware anon clients for ordinary routes.
- Keep service-role clients inside trusted provider/reconciliation or private-certificate boundaries.
- Do not expose signed certificate URLs except through the intended owner/admin route; admin signed reads expire in 300 seconds.
- Preserve 401/403/404/409/422 contracts and safe `next` redirects.

## VERIFY
```bash
corepack pnpm test:api:contracts
corepack pnpm test:coach-certification
corepack pnpm typecheck
```
