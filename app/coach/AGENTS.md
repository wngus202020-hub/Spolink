# COACH APP ROUTER GUIDE

## OVERVIEW

`app/coach/` separates certification applicants from approved-coach operations.

## SURFACES

```text
coach/
├── apply/          # Applicant draft, certificate upload, submission, status
├── dashboard/      # Approved-coach owner-scoped operations summary
├── lessons/        # Approved-coach lesson authoring and schedule management
├── reservations/   # Approved-coach reservation operations
└── settlements/    # Approved-coach settlement read model
```

## APPLICANT STATE

- `/coach/apply` and `/coach/apply/status` start with `readPageAuthProfile()` or the fuller server
  profile read, then route anonymous/unconfigured users to login and profile-required users to
  onboarding.
- Applicant flow owns its draft and private certificate metadata. `draft` is editable; submitted,
  approved, and suspended states are read-only or status-directed by server data.
- Status reads use the current account's `coach_profiles` record; do not use a URL, form field, or
  client cache as the applicant identity or status authority.
- Keep application-status route-local loading/error boundaries and deterministic UI fixtures used
  by browser tests.

## APPROVED-COACH STATE

- Dashboard, lesson list/new/edit/schedule, reservation, and settlement pages call
  `readApprovedCoachPage(nextPath)` before reading operational data.
- The boundary requires both `coach_profiles.status === "approved"` and
  `profiles.status === "coach_approved"`; other authenticated applicants redirect to application
  status.
- Recheck lesson ownership, schedule state, reservation eligibility, and settlement visibility in
  the API/workflow. Page-level approval does not authorize a write.
- `/coach/dashboard` is a force-dynamic, no-store Server Component read model over existing
  RLS-protected data. It adds no dashboard API endpoint and exposes only owner-scoped schedules,
  reservation counts, pending settlement totals, anonymous reviews, and unread notifications.
- Preserve existing local `loading.tsx`/`error.tsx` UI beside dashboard, lesson, reservation, and
  settlement segments; use their Korean recovery copy, heading focus, and retry/reset behavior.

## DO NOT

- Do not let clients set `coach_profile_id`, applicant/coach status, reviewer, submission/review
  timestamps, or private certificate paths.
- Do not authorize an edit from a lesson ID alone or reuse an approved-coach client session as a
  service-role capability.
- Do not bypass typed authoring, reservation-lifecycle, or money workflows with page-local writes.

## TESTS

- Applicant/certification contracts: `corepack pnpm test:coach-certification`.
- Lesson authoring contracts: `tests/lesson-authoring-contract.test.mjs`.
- Applicant browser coverage: `tests/auth-ui-e2e/coach-apply.spec.ts` and
  `tests/auth-ui-e2e/coach-application-status.spec.ts`.
- Operational money/reservation contracts: `tests/money-operations-contract.test.mjs` and
  `tests/reservation-lifecycle-contract.test.mjs`.
- Dashboard read-model contracts:
  `node --test tests/coach-dashboard-read-model.test.mjs tests/coach-dashboard-contract.test.mjs`.
- Managed dashboard browser coverage: `corepack pnpm test:e2e:coach-dashboard`.
