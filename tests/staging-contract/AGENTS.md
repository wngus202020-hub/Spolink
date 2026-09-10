# STAGING CONTRACT TEST GUIDE

## OVERVIEW
This directory verifies provider/staging command policy and evidence gates; it does not deploy hosted services.

## CONTRACTS
- Reject forbidden/destructive commands and invalid provider contracts.
- Validate allowed command shapes, environment naming, evidence paths, and secret redaction.
- Keep provider checklist outputs redacted and hash-backed; do not record tokens, cookies, keys, credentialed URLs, or raw provider bodies.

## COMMANDS
```bash
corepack pnpm staging:contract:test
corepack pnpm staging:contract
```

## SCOPE
A separate Hosted Supabase/Vercel staging deployment and Mailtrap-backed custom SMTP now exist.
Confirmation/recovery browser E2E is provider-verified; CI/CD, production, Toss refund execution,
payout, and chat remain deferred. Local address geocoding and coordinate-backed lesson map/list
discovery are implemented, but this suite does not prove live NAVER credentials, provider tiles,
current-location distance sorting, or bounds search. The root map browser QA uses a NAVER SDK stub
and is likewise not live-provider proof. Realtime/Web Push exists locally, but hosted migrations,
worker scheduling, and external Push Service delivery proof remain pending. Offline contract success
alone is not provider proof and must not be described as a production release.

## PROVIDER BOUNDARY
- Do not add or print NAVER client credentials while running these local checks.
- Do not infer live map rendering from a local geocoding result, a stubbed browser run, or a passing
  staging contract.
- Hosted Push remains pending until the deployed migration, worker scheduling, and real external
  Push Service delivery are separately verified with redacted provider evidence.
