# AUTH ROUTE GUIDE

## OVERVIEW

`app/auth/` owns the visible email-auth pages and thin callback, recovery, logout, password-update,
and restricted-account Route Handlers. Cryptographic and session policy stays in `lib/auth/`.

## ROUTE MAP

| Surface | Responsibility |
|---|---|
| `login`, `signup`, `check-email` | Compose `components/auth/` forms and safe status copy |
| `callback` | Delegate PKCE code exchange and profile-state routing |
| `recovery/start` | Begin signed password-recovery intent flow |
| `update-password`, `update-password/submit` | Require and consume the bound recovery grant |
| `logout`, `restricted` | Clear local session and auth-flow cookies through `lib/auth/` |

## CONVENTIONS

- Keep Route Handlers as one-line adapters to the factories in `lib/auth/`; do not duplicate token,
  cookie, redirect, or profile-state logic here.
- Callback success routes profile-missing users to onboarding, ready users to a safe allowlisted
  `next`, and suspended/deleted users to the restricted boundary.
- Only the exact recovery callback intent may issue a recovery grant. Ordinary email or future OAuth
  callbacks must stay on the normal session path.
- Auth pages use `AuthShell`, Korean recovery copy, and generic provider-safe errors. Do not expose
  whether an email, identity, or provider account exists.
- A future social provider must return through the existing callback. Client IDs and secrets belong
  in provider configuration, never page props, browser code, repository env files, or logs.

## ANTI-PATTERNS

- Do not accept arbitrary external `next` URLs or decode/normalize them outside `lib/auth/redirect.ts`.
- Do not log authorization codes, recovery markers, session IDs, cookies, emails, or provider payloads.
- Do not replace verified `sub` and `session_id` claims with request fields or decoded JWT data.
- Do not weaken `private, no-store`, refreshed `Set-Cookie`, same-origin, JSON, or strict-schema rules.

## VERIFY

```bash
corepack pnpm test:e2e:auth
corepack pnpm test:api:contracts
corepack pnpm typecheck
```
