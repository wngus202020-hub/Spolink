# RESERVATION DOMAIN GUIDE

## SCOPE

`reservations/` owns learner booking, owned read models, completion/calendar eligibility,
learner/coach lifecycle actions, and admin reservation operations.

## MAP

| Concern | Primary files | Boundary |
|---|---|---|
| Create pending booking | `create-reservation-api.ts`, `booking-request-client.ts` | `create_pending_reservation` RPC |
| Learner list/detail | `reservation-read-{query,data,view,presentation}.ts` | learner-owned reservation first |
| Payment completion page | `completion-page-data.ts` | `confirmed` **and** payment `paid` |
| ICS download | `calendar-route-handler.ts`, `reservation-calendar.ts` | owner-only, eligible completion |
| Learner cancellation | `cancel-reservation-api.ts`, `cancel-reservation-route-adapter.ts` | `cancel_reservation` RPC |
| Complete/no-show | `reservation-lifecycle-{api,route-adapter}.ts` | `transition_reservation_lifecycle` RPC |
| Admin list/transition | `admin-{operations,workflow,route-handlers}.ts` | active-admin gate, `transition_admin_reservation` |

## READ AND PRESENTATION

- Query the learner-owned reservation before enriching private lesson, schedule, coach, payment, or refund data.
- Keep read outcomes distinct: `not_found`, `read_failure`, empty list, and ready data.
- `ReservationDetailView` is the presentation contract; do not make page code rebuild payment, refund, or cancellation state.
- Continue-payment affordance requires `pending_payment`, unexpired `payment_expires_at`, and no conflicting payment.
- Completion is `complete` only for reservation `confirmed` plus payment `paid`; every other combination is pending,
  mismatch, terminal, not-found, or read-failure as classified in `completion-page-data.ts`.
- The completion reader takes `learnerId`; do not turn it into a public reservation lookup.

## CALENDAR AND PII

- `calendar-route-handler.ts` authenticates, reads through the owner-scoped completion path, then permits only `complete`.
- ICS responses stay `private, no-store`; reject pending, mismatch, terminal, missing schedule, and invalid IDs.
- Include only the calendar input fields already derived from the owned view; do not add learner/coach contact PII.

## TRANSITION OWNERSHIP

- Create only `pending_payment`; SQL owns schedule locking, eligibility, current price, expiry, and capacity accounting.
- Cancellation sends only reservation ID and reason. SQL owns actor, clock, authorization, refund amount, capacity restore,
  notifications, and audit rows.
- Lifecycle and admin transitions stay RPC-backed and idempotency-aware; terminal/status writes are never client-computed.
- Completion and no-show require the SQL-side confirmed-and-paid precondition; no-show timing comes from SQL time.
- Preserve typed RPC error mapping so conflict, forbidden, missing, and invalid transition remain observable to routes.

## MIGRATION AND TEST COUPLING

- Start with the newest lifecycle correction, `supabase/migrations/20260818120000_use_statement_time_for_reservation_lifecycle.sql`.
- Trace its predecessors: `20260814120000_add_reservation_lifecycle.sql`,
  `20260814180000_add_admin_reservation_dispute_transition.sql`, and
  `20260814200000_add_admin_reservation_transition_result.sql`.
- Any RPC signature/state change updates `lib/supabase/database.types.ts`, route adapters, SQL contracts, and race tests together.
- Cancellation coverage: `tests/reservation-cancel-*.test.mjs` and
  `tests/supabase-e2e/cancellation-concurrency*.test.mjs`.
- Completion/calendar/lifecycle coverage: `tests/reservation-{completion,calendar,lifecycle}*.test.mjs` and
  `tests/supabase-e2e/reservation-lifecycle.test.mjs`.

## VERIFY

```bash
node --test tests/reservation-*.test.mjs tests/reservations-api.test.mjs
corepack pnpm test:e2e:reservations
corepack pnpm test:e2e:supabase
```
