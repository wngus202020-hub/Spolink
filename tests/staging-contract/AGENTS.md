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
Hosted Supabase, Vercel, Toss, maps, chat, push, and production deployment remain deferred until separately planned and documented.
