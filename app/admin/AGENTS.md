# ADMIN APP ROUTER GUIDE

## OVERVIEW

`app/admin/` is the server-rendered back-office surface for active administrators.

## SURFACES

```text
admin/
├── ./              # Five count-only operational queues
├── coaches/       # Certification application list, detail, approve/reject, certificate access
├── lessons/       # Lesson review lifecycle
├── reports/       # Trust-and-safety queue and resolution
├── reservations/  # Operational reservation reads and transitions
└── settlements/   # Hold/approval operational states
```

## ACCESS BOUNDARY

- Resolve server auth before every read: unauthenticated/unconfigured to login with the concrete
  admin `next`; profile-required to onboarding; deleted/suspended to restricted where applicable.
- Active admin means `auth.kind === "ready"`, `profile.role === "admin"`, and
  `profile.status === "active"`; all other ready accounts redirect to `/mypage`.
- Use `readServerAuthProfile()` where the page needs deleted/suspended classification. Do not turn
  page authorization into a client-side condition.
- Recheck active-admin identity, target ownership/visibility, and current transition state in the
  API/workflow. Page access never authorizes an operational write by itself.

## OPERATIONS

- `/admin` is an active-admin-only, count-only overview of five operational queues. It uses the
  server read model at load time; keep zero-count destinations clickable and keep failures at the
  whole-page boundary rather than rendering partial totals.
- 3A: failing-first TDD plus managed responsive Playwright verification at 390/768/1280, local-only.
- Coach review pages: `coaches/` list/detail; certificate access is private and signed through the
  intended admin route, never embedded as a durable public URL.
- Lesson, report, reservation, and settlement pages are operational read models; preserve their
  typed repository/workflow boundaries and server-derived state transitions.
- Admin reservation list/detail retain their local `loading.tsx`/`error.tsx` states and fixture
  query behavior used by browser coverage.
- Administrative actions may send review notes or action inputs only. Actor, profile/coach status,
  reviewer, effective timestamp, amount, and transition result are server authoritative.

## DO NOT

- Do not accept a client-provided admin ID, reviewer ID, target status, or action time.
- Do not expose certificate storage paths, service-role credentials, or signed URLs outside the
  private certificate endpoint.
- Do not collapse 403, missing target, conflict, or validation outcomes into a successful UI state.

## TESTS

- Certification/admin contracts: `corepack pnpm test:coach-certification`.
- API contract inventory: `corepack pnpm test:api:contracts`.
- Dashboard documentation contract: `node --test tests/admin-dashboard-documentation.test.mjs`.
- Dashboard browser coverage: `corepack pnpm test:e2e:task-10`.
- Browser admin-review coverage: `tests/auth-ui-e2e/admin-coach-review.spec.ts`.
- Reservation operation contract: `tests/admin-reservation-operations.test.mjs`.
