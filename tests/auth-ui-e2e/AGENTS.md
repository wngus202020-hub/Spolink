# AUTH UI E2E GUIDE

## OVERVIEW

This directory owns serial Playwright flows for auth, onboarding, profile/avatar/account settings,
booking, payment preparation, reservations/completion, favorites, notifications, coach guidance,
coach certification, and visual direction checks.

## LIFECYCLE

- `run.mjs` is the Auth aggregate only; do not fold booking, reservation, payment, or coach runners into it.
- `run.mjs` runs its confirmation modes sequentially; package composition invokes focused runners separately.
- `run-mypage-profile-edit.mjs` is the focused `/mypage/profile` runner; keep it outside the Auth
  aggregate and run it through `corepack pnpm test:e2e:profile-edit`.
- `run-mypage-reviews.mjs` is the focused `/mypage/reviews` managed runner; keep it outside the Auth
  aggregate and pass an explicit mode-restricted summary path.
- New browser runners reuse `withConfiguredAuthMode`; do not duplicate server/Supabase startup.
- `lifecycle.mjs` owns loopback ports, Auth config snapshot/restore, Supabase reset, Next child,
  readiness, signals, and final stopped-state checks.
- `direction-alignment` is the documented exception with its own owned built-server lifecycle.
- Playwright runs serially (`workers: 1`) because tests share Auth and server state.
- Live users and recovery grants are created through helpers and removed in `finally`.

## FILE PATTERNS

- `*.spec.ts`: browser behavior and accessibility scenarios.
- `*.test.mjs`: runner, lifecycle, source, and security contracts.
- `run-*.mjs`: focused executable entry points.
- Shared selectors, request observers, recovery helpers, and lifecycle utilities stay in helpers;
  do not hide assertions in opaque setup code.

## PACKAGE OWNERSHIP

- `test:e2e:auth`: `run.mjs`, booking confirmation, and coach certification, in that order.
- `test:e2e:payment`: payment preparation only.
- `test:e2e:profile-edit`: the focused `/mypage/profile` desktop/tablet/mobile runner.
- `test:e2e:profile-avatar`: profile image upload and removal, including the no-image state before and after removal.
- `test:e2e:account-settings`: authenticated withdrawal confirmation and cleanup states.
- `test:e2e:notifications`: in-app Realtime catch-up and Web Push opt-in states.
- `test:e2e:reservations`: learner list/detail/completion/calendar only.
- `test:e2e:coach-dashboard`: approved-coach operational dashboard states.
- My Page review management remains a direct focused runner with no package aggregate registration.
- Do not register focused payment, profile, review-management, or reservation runners inside `run.mjs`.

## EVIDENCE AND SECURITY

- Evidence JSON/JSONL belongs under `.omo/evidence`; raw Playwright output does not.
- Runner-owned raw output is a mode-0700 external directory and is removed unless `retain` is set.
- A `suppliedDir` is caller-owned: retain it regardless of `retain`; the caller cleans its own root.
- Use the shared redaction writer and record exit code, output hash, verdict, and cleanup proof.
- Assert no email, password, recovery marker, cookie, token, key, or provider payload leaks to UI,
  console, reports, or evidence.
- Cover duplicate submit, abort/timeout, provider 5xx, retry, focus, replay, cross-origin, and open
  redirect behavior when touching those boundaries.
- Coach certification flows must cover applicant draft/submit, upload errors, pending/rejected/
  approved states, admin review visibility, and refresh-safe status rendering.
- Profile edit runs desktop/tablet/mobile projects, expects 9 passed tests total, and publishes
  exactly four PNGs: three success screenshots plus one mobile validation screenshot.
- Reservation completion runs mobile/tablet/desktop (390/768/1280) with success and recovery views:
  publish exactly six PNGs, validate nonempty ICS download, and assert completion persistence.
- Publish reservation evidence as a mode-restricted versioned bundle, atomically update `current`, and
  bind `focused-summary.json` to the six image hashes through `source-run-manifest.json`.
- Review management must prove owner visible/hidden, deleted exclusion, public visible-only, owner
  isolation, redirects, read failure, pagination, and exactly nine hash-bound responsive/dark PNGs.

## RUN

```bash
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:profile-edit
corepack pnpm test:e2e:profile-avatar
corepack pnpm test:e2e:account-settings
corepack pnpm test:e2e:notifications
corepack pnpm test:e2e:reservations
corepack pnpm test:e2e:coach-dashboard
corepack pnpm test:e2e:direction-alignment
node tests/auth-ui-e2e/run-mypage-reviews.mjs .omo/evidence/mypage-reviews-management/task-8/focused-summary.json
```
