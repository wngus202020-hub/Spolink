# AUTH LIBRARY GUIDE

## SCOPE

`lib/auth/` owns session-route helpers, account-page classification, redirect policy,
recovery markers, and auth cookies. Read `lib/supabase/AGENTS.md` when changing a client boundary.

## CLAIMS AND ACCOUNT STATE

- Trust identity only after `readVerifiedClaims()` accepts non-empty `sub` and `session_id`.
- Never take user identity, role, or `session_id` from request JSON, query data, or a decoded token.
- Bind privileged recovery work to both verified `sub` and verified `session_id`.
- `readServerAuthProfile()` is the page-state source: `anonymous`, `profile_required`, `ready`,
  `account_suspended`, or `account_deleted`.
- `readPageAuthProfile()` redirects deleted/suspended accounts; callers still branch anonymous,
  onboarding-required, and ready states deliberately.
- Keep route-specific role checks separate from the generic page-account state machine.

## REDIRECTS AND ROUTE GUARDS

- Pass raw URL input through `resolveSafeNextPathFromUrl()` or `resolveSafeNextPath()`.
- Accept only the explicit route allowlist and constrained booking/reservation/payment forms.
- Reject decoded `next`, percent escapes, backslashes, fragments, controls, `//`, and path traversal.
- Use fixed destinations for recovery and any route that cannot safely honor a caller destination.
- Mutations retain same-origin, JSON content-type, schema, configuration, then claims checks.

## RECOVERY FLOW

- Start creates a short-lived HMAC recovery-intent token and HttpOnly flow cookie.
- Callback requires the exact recovery destination, exchanges the code, then verifies claims.
- Recovery tokens use canonical payload bytes, exact ordered keys, HMAC verification, expiry, and `jti`.
- Hash the token identifier before `issue_password_recovery_grant`; never persist the marker itself.
- Password update verifies marker claims/session binding, consumes the grant atomically, and clears it.
- Treat reused, expired, mismatched, malformed, or provider-failed recovery input as a safe failure.

## COOKIES AND RESPONSES

- Route Supabase clients receive response headers and append every refreshed `Set-Cookie`.
- Preserve flow-cookie secure, path, expiry, and clearing behavior in `cookies.ts`.
- Return auth JSON and redirects through `authJsonData`, `authJsonError`, or `authRedirect`.
- Those helpers must retain `Cache-Control: private, no-store`, including failure paths.
- Do not log recovery markers, codes, cookies, session IDs, provider payloads, or email addresses.

## TESTS

- Unit/contract surfaces: `tests/auth-ui-e2e/session-routes.test.mjs`,
  `redirect-proxy.test.mjs`, and `auth-forms-contract.test.mjs`.
- Browser recovery and password update scenarios live in `auth-recovery-diagnostic.spec.ts` and
  `auth-update-password.spec.ts`.
- Cover cross-origin, malformed JSON, open redirect, session mismatch, expired/replayed grant,
  cookie refresh/clear, and suspended/deleted account branches.

```bash
corepack pnpm test:api
corepack pnpm test:api:contracts
corepack pnpm test:e2e:auth
```
