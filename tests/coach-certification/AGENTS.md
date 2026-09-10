# COACH CERTIFICATION TEST GUIDE

## OVERVIEW
This directory locks coach applicant/admin contracts, private Storage, submission/review RPCs, concurrency, and security behavior.

## TEST LAYERS
- `*.test.mjs`: typed contracts, route/workflow boundaries, storage and status invariants.
- SQL pgTAP/RLS tests live in `supabase/tests/`, including `coach_application_submission.test.sql`
  and `coach_application_review.test.sql`; keep transactional permissions there rather than adding SQL here.
- `*-e2e.mjs`: real local Supabase upload/read/submit/review and cleanup.
- Browser specs/runners live in `tests/auth-ui-e2e/`; do not duplicate lifecycle ownership here.

## SCOPE BOUNDARIES
- This directory owns focused Node contracts for the coach certification workflow; it does not own the
  PostgreSQL test harness or browser lifecycle.
- `test:e2e:auth` is an aggregate that includes the coach certification browser runner after Auth and
  booking confirmation. It is broader than a focused certification browser invocation.
- `test:e2e:supabase` is a separate broad local-Supabase aggregate. Do not describe either aggregate
  as a substitute for the focused Node, SQL, and browser evidence that a certification change needs.

## REQUIRED CASES
Cover draft save/reload, owner/foreign/anonymous Storage access, MIME/magic/size rejection, overwrite/delete protection, atomic submit, concurrent winner/conflict, reject/resubmit/approve, same-decision idempotency, opposite stale conflict, signed URL TTL, direct status/reviewer mutation denial, and no partial state.

## COMMANDS
```bash
corepack pnpm test:coach-certification
corepack pnpm test:api:contracts
corepack pnpm supabase:test:db
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:supabase
corepack pnpm supabase:assert-stopped
```

Run `test:coach-certification` first for focused Node contracts. Run `supabase:test:db` for the
`supabase/tests/` pgTAP suite, then select the appropriate aggregate only when its wider lifecycle is needed.

## EVIDENCE
Use redacted hash-backed receipts only. Files are `0600`, directories `0700`; never record JWTs, cookies, UUIDs, emails, DB URLs, signed URLs, raw certificate data, or provider secrets.
