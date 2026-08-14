# AUTH UI E2E GUIDE

## OVERVIEW

This directory owns serial Playwright flows for auth, onboarding, booking, payment preparation,
reservations, favorites, coach guidance, coach certification, and visual direction checks.

## LIFECYCLE

- `run.mjs` is the canonical Auth E2E entry and runs confirmation modes sequentially.
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

## EVIDENCE AND SECURITY

- Evidence JSON/JSONL belongs under `.omo/evidence`; raw Playwright output does not.
- Raw output uses a mode-0700 external temp directory and is deleted unless the retain flag is set.
- Use the shared redaction writer and record exit code, output hash, verdict, and cleanup proof.
- Assert no email, password, recovery marker, cookie, token, key, or provider payload leaks to UI,
  console, reports, or evidence.
- Cover duplicate submit, abort/timeout, provider 5xx, retry, focus, replay, cross-origin, and open
  redirect behavior when touching those boundaries.
- Coach certification flows must cover applicant draft/submit, upload errors, pending/rejected/
  approved states, admin review visibility, and refresh-safe status rendering.

## RUN

```bash
corepack pnpm test:e2e:auth
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:reservations
corepack pnpm test:e2e:direction-alignment
```
