# SUPABASE LIBRARY GUIDE

## CLIENT BOUNDARIES

- `client.ts`: `createSupabaseBrowserClient()` for browser-safe anonymous-key access only.
- `public-read-client.ts`: `createSupabasePublicReadClient()` supports unconfigured public lesson reads;
  `getSupabasePublicStorageUrl()` is for public lesson-image URLs.
- `server.ts`: `createSupabaseServerClient(responseHeaders)` is the request-bound client. It and the auth
  route/page helpers are the central cookie boundary; do not create parallel cookie implementations.
- `proxy.ts`: `refreshSupabaseSessionInProxy()` is the proxy-only session refresh boundary.
- `../auth/server-profile.ts` and auth route clients use cookie-aware server clients; do not create
  parallel cookie implementations.

## ENVIRONMENT

`env.ts` parses Supabase public/service configuration, Toss secret configuration, trusted Edge configuration,
and Web Push VAPID configuration with matching safe status readers. Report missing or invalid keys without
logging values.

- Browser code may receive only the public Supabase URL/anon key and
  `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY`.
- Service-role, Toss, Edge, Web Push private key, and Web Push subject values stay server-only.
- Use `readSupabasePublicEnv()` and `getSupabaseConfigStatus()` for public client setup; preserve
  unconfigured mode rather than synthesizing a configured client.

## COOKIE PROPAGATION

- Pass a fresh `Headers` object into request-bound server clients.
- Merge every Supabase `Set-Cookie` into that response; do not collapse multi-cookie refreshes.
- Proxy refresh updates request cookies, response cookies, forwarded headers, and private no-store caching.
- Route handlers return the same headers after workflow completion, including error responses.

## STORAGE VISIBILITY

- `lesson-images` and `profile-avatars` are public-read and are distinct from private `coach-certificates`.
- The certificate applicant owner reads directly under the current Storage `SELECT` policy. An active admin
  gets an authorized 300-second signed read; never claim applicants receive signed reads.
- Public bucket reads do not authorize mutation: retain the owner/intent policies and domain workflow checks.

## SERVICE ROLE

- `createSupabaseServiceClient()` remains server-only, with auth persistence disabled.
- Restrict it to trusted provider verification/reconciliation, guarded refund or settlement RPC work,
  authorized active-admin certificate reads, and narrowly scoped server enrichment after a
  session-owned record or safe public identifiers establish the permitted relation set.
- Do not import it into browser code or use it to bypass owner/admin authorization checks.
- Establish caller claims and domain authorization before a service-role call; keep provider secrets out
  of payloads, logs, and responses.

## DATABASE TYPES

- `database.types.ts` is the hand-maintained projection of committed migrations: tables, enums, views, and RPC
  signatures. It is not a generated artifact to blindly regenerate.
- Update it with the matching migration/RPC contract. Compare names, nullability, arguments, returns, and
  readonly row/insert/update shapes against `../../supabase/migrations/`; do not invent application schema.

## TESTS

- Environment/client behavior: `tests/supabase-local-guard/config-and-status.test.mjs` and
  `tests/auth-ui-e2e/redirect-proxy.test.mjs`.
- RLS and authenticated access: `tests/supabase-e2e/auth-rls.test.mjs`.
- Private certificate storage/read coverage: `tests/coach-certification/storage-contract.test.mjs`
  and `storage-e2e.mjs`.
- Migration, RPC, or privileged-client changes require the matching SQL contract and live E2E lane.

```bash
corepack pnpm typecheck
corepack pnpm test:api:contracts
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```
