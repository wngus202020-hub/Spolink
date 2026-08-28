# SUPABASE LIBRARY GUIDE

## CLIENT CHOICES

- `client.ts`: `createSupabaseBrowserClient()` for browser-safe anonymous-key access only.
- `public-read-client.ts`: `createSupabasePublicReadClient()` for unauthenticated public lesson reads
  and public lesson-image URLs; honor unconfigured mode instead of synthesizing a configured client.
- `server.ts`: `createSupabaseServerClient(responseHeaders)` for request-bound server reads/writes.
- `proxy.ts`: `refreshSupabaseSessionInProxy()` is the proxy-only session refresh boundary.
- `../auth/server-profile.ts` and auth route clients use cookie-aware server clients; do not create
  parallel cookie implementations.

## ENVIRONMENT AND STATUS

- Read public credentials through `readSupabasePublicEnv()`; never expose service-role data.
- Use `getSupabaseConfigStatus()` when a safe unconfigured response is required.
- Service, Toss, and edge readers have matching status functions; report missing/invalid keys, not values.
- Keep environment schemas and consumers aligned with local lifecycle status readers in `scripts/`.

## COOKIE PROPAGATION

- Pass a fresh `Headers` object into request-bound server clients.
- Merge every Supabase `Set-Cookie` into that response; do not collapse multi-cookie refreshes.
- Proxy refresh updates request cookies, response cookies, forwarded headers, and private no-store caching.
- Route handlers return the same headers after workflow completion, including error responses.

## SERVICE ROLE

- `createSupabaseServiceClient()` remains server-only, with auth persistence disabled.
- Restrict it to trusted provider verification/reconciliation, guarded refund or settlement RPC work,
  authorized private admin certificate reads, and narrowly scoped server enrichment after a
  session-owned record or safe public identifiers establish the permitted relation set.
- Do not import it into browser code or use it to bypass owner/admin authorization checks.
- Establish caller claims and domain authorization before a service-role call; keep provider secrets out
  of payloads, logs, and responses.

## DATABASE TYPES

- `database.types.ts` is the hand-maintained projection of committed migrations, tables, enums, views,
  and RPC signatures.
- Update it in the same change as a migration/RPC contract; preserve readonly row/insert/update shapes.
- Compare names, nullability, arguments, and returns against `supabase/migrations/`; do not invent
  application-only schema variants.

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
