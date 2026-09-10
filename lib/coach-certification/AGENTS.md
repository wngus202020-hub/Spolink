# COACH CERTIFICATION GUIDE

## OVERVIEW
This directory owns typed applicant/admin workflows, repositories, private certificate boundaries, submission RPCs, and review result mapping.

## WHERE TO LOOK
- Applicant route/workflow wiring: `applicant-route-handlers.ts`, `applicant-workflow.ts`.
- Admin decisions and signed reads: `admin-route-handlers.ts`, `admin-certificate-repository.ts`.
- Certificate validation and object lifecycle: `../storage/coach-certification.ts`.
- Transaction authority: certification migrations and pgTAP suites under `supabase/`.

## BOUNDARIES
- Route handlers parse/authenticate; workflows authorize and map typed results; repositories call Supabase/RPC.
- Applicants remain `profiles.role=learner`; draft/rejected is active, submitted is pending, approved is coach-approved, and suspended is suspended.
- Draft writes and paired submit/review transitions are RPC/workflow-only; clients cannot set status, reviewer, timestamps, or ownership.
- `coach-certificates` is private. Applicants read their owner path through Storage RLS; only active
  admins receive a 300-second signed read after the registered object is verified.
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
