# Final verification sanitizer fix

## Cause

The modified submission E2E used a title-cased, person-like synthetic value for the ordinary
`profiles.display_name` write. The successful E2E observable does not publish that value, but an
assertion or provider diagnostic can include it. The final publication sanitizer therefore failed
closed before retaining the command logs.

The evidence redaction utility remains correct: it rejects fixture addresses, credentials,
authorization material, sensitive structured keys, and configured run secrets. Its rules were not
weakened.

## Minimal fix

- Changed only the synthetic ordinary-write display value in
  `tests/coach-certification/submission-e2e.mjs` to the lowercase machine fixture token
  `fixture-ordinary-edit`.
- Kept the observable labels, mutation assertions, redaction utility, database contracts, and
  application behavior unchanged.
- Added no test because the existing redaction suite already exercises the relevant fail-closed
  output rules; the issue was the E2E fixture value, not missing sanitizer behavior.

## Focused verification

- `corepack pnpm exec node --test tests/coach-certification/submission-*.test.mjs tests/supabase-e2e/evidence-redaction.test.mjs`
  - PASS: 13 tests, 0 failures.
- `corepack pnpm exec biome check tests/coach-certification/submission-e2e.mjs tests/supabase-e2e/evidence-redaction.mjs tests/supabase-e2e/evidence-redaction.test.mjs`
  - PASS: 3 files, no fixes.
- `corepack pnpm exec tsc --noEmit --pretty false`
  - PASS.

No database or browser verification was run, as required.
