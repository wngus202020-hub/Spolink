# API ROUTE GUIDE

## OVERVIEW
`app/api/` contains thin Next Route Handlers. They authenticate and validate requests, then delegate policy and persistence to typed `lib/` workflows/RPCs.

## REQUEST ORDER
1. same-origin and method/content type
2. parse JSON and validate with the domain schema
3. verify configured state and `getClaims()` identity
4. enforce authorization and state preconditions
5. invoke the workflow and map its typed result
6. return `private, no-store` mutation responses

## COACH CERTIFICATION
Applicant/admin routes never accept profile status, reviewer, review timestamps, or ownership identifiers from clients. Applicant draft writes and submit use the approved workflow/RPC; admin decisions require active-admin claims and server-side transaction checks.

## SECURITY
- Use cookie-aware anon clients for ordinary routes.
- Keep service-role clients inside trusted provider/reconciliation boundaries.
- Do not expose signed certificate URLs except through the intended owner/admin route; admin signed reads expire in 300 seconds.
- Preserve 401/403/404/409/422 contracts and safe `next` redirects.

## VERIFY
```bash
corepack pnpm test:api:contracts
corepack pnpm test:coach-certification
corepack pnpm typecheck
```
