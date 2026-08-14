# COACH CERTIFICATION TEST GUIDE

## OVERVIEW
This directory locks coach applicant/admin contracts, private Storage, submission/review RPCs, concurrency, and security behavior.

## TEST LAYERS
- `*.test.mjs`: typed contracts, route/workflow boundaries, storage and status invariants.
- `*.sql`: pgTAP/RLS grants, RPC transitions, direct mutation denial, and side effects.
- `*-e2e.mjs`: real local Supabase upload/read/submit/review and cleanup.
- Browser specs/runners live in `tests/auth-ui-e2e/`; do not duplicate lifecycle ownership here.

## REQUIRED CASES
Cover draft save/reload, owner/foreign/anonymous Storage access, MIME/magic/size rejection, overwrite/delete protection, atomic submit, concurrent winner/conflict, reject/resubmit/approve, same-decision idempotency, opposite stale conflict, signed URL TTL, direct status/reviewer mutation denial, and no partial state.

## COMMANDS
```bash
corepack pnpm test:coach-certification
corepack pnpm test:api:contracts
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```

## EVIDENCE
Use redacted hash-backed receipts only. Files are `0600`, directories `0700`; never record JWTs, cookies, UUIDs, emails, DB URLs, signed URLs, raw certificate data, or provider secrets.
