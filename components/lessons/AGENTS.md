# LESSON COMPONENT GUIDE

## SCOPE

`lessons/` owns public discovery controls, coach lesson/schedule authoring clients, and the
browser-side booking request. Pages own server data; `lib/` owns the authority-bearing workflow.

## PUBLIC SEARCH

- `lesson-search-picker.tsx` is the single owner of draft versus applied filter state.
- Keep `region`, `sport`, and `date` as the `/lessons` GET query contract; normalize in
  `lib/lesson-search.ts`, not in a new component-local format.
- `lesson-search-summary.tsx` owns trigger summaries; option panels own selectable region/sport UI.
- Desktop uses the inline panel; mobile uses `lesson-search-sheet.tsx` and its draft/apply/reset
  lifecycle. Do not let a sheet dismissal submit or leak an un-applied draft.
- Preserve tab roles, arrow/Home/End navigation, selected-panel IDs, and the search trigger focus
  return when changing the picker or sheet.
- Native date input accepts only `YYYY-MM-DD`; preserve server-provided initial filters on rerender.

## REGION CATALOG

- `lib/lesson-regions.ts` is generated; never hand-edit it.
- Source chain: `scripts/generate-lesson-regions.mjs` -> `lib/lesson-regions.ts` -> search option
  panels and picker.
- Validate a catalog refresh with `node scripts/generate-lesson-regions.mjs --check` and
  `node --test tests/lesson-regions.test.mjs`.

## COACH AUTHORING

- `coach-lesson-form.tsx` uses `lib/lessons/authoring-client.ts` for create, update, and status
  transitions; retain the optimistic-concurrency `expectedUpdatedAt` value.
- `coach-schedule-manager.tsx` uses the same client for create/update/close. Keep KST conversion,
  capacity bounds, open-state restrictions, and returned server errors visible.
- Authoring UI may request a transition; route handlers and workflows decide eligibility and state.

## BOOKING

- `booking-request-form.tsx` calls `lib/reservations/booking-request-client.ts` only.
- Send lesson and schedule IDs, never prices, refund data, cancellation data, or a target payment
  state. Route according to the returned unauthorized/profile/payment href outcome.
- Block duplicate submission and keep the pending-payment wording tied to the server result.

## CHECKS

- Test Korean/CJK labels, long district and sport names, focused error copy, and date values.
- Exercise keyboard tabs, Escape, overlay dismissal, initial focus, and returned trigger focus.
- Inspect public picker and authoring/schedule layouts at 390, 768, and 1280 px.
- Focused coverage: `node --test tests/lesson-search-options.test.mjs
  tests/lesson-authoring-contract.test.mjs tests/booking-confirmation-contract.test.mjs`.
