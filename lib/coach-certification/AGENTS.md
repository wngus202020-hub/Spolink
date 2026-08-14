# COACH CERTIFICATION GUIDE

## OVERVIEW
This directory owns typed applicant/admin workflows, repositories, private certificate boundaries, submission RPCs, and review result mapping.

## BOUNDARIES
- Route handlers parse/authenticate; workflows authorize and map typed results; repositories call Supabase/RPC.
- Applicants remain `profiles.role=learner`; draft/rejected is active, submitted is pending, approved is coach-approved, and suspended is suspended.
- Draft writes and paired submit/review transitions are RPC/workflow-only; clients cannot set status, reviewer, timestamps, or ownership.
- `coach-certificates` is private. Store object names only, validate MIME plus magic bytes and 10MiB, prevent overwrite, and issue admin signed reads for 300 seconds.
- Approve/reject locks rows and writes paired state plus exactly-once audit/notification effects.

## TESTS
```bash
corepack pnpm test:coach-certification
corepack pnpm test:api:contracts
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:supabase
```

## ANTI-PATTERNS
- Do not move policy into client components or accept client-controlled state.
- Do not expose service-role credentials, raw certificate content, signed URLs in evidence, or PII.
- Do not weaken RLS/Storage checks to make a runner pass.
