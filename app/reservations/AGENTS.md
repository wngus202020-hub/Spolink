# RESERVATION CHECKOUT ROUTE GUIDE

## OVERVIEW

`app/reservations/` renders learner checkout and confirmed-payment completion states. It projects
server-owned reservation/payment facts; it does not own payment or reservation transitions.

## SURFACES

```text
reservations/[reservationId]/
├── payment/   # Ready, expired, confirmed, terminal, mismatch, and recovery presentations
└── complete/  # Strict confirmed + paid success and calendar access
```

## CONVENTIONS

- Treat dynamic `params` and `searchParams` as promises and validate the reservation UUID before use.
- Payment pages read through `lib/payments/payment-page-*`; browser components may prepare or submit
  provider evidence only through the documented APIs.
- Completion renders success only when stored reservation status is `confirmed` and payment status
  is `paid`. Pending, terminal, mismatch, not-found, and read-failure states retain distinct routing
  or recovery behavior.
- Recheck authenticated learner ownership in the server read model. A route parameter, prior page,
  or successful provider redirect is not authorization.
- Calendar links use the owner-only completion API and must not expose learner/coach contact PII.
- Keep state-specific presentation data separate from domain classification so copy changes cannot
  alter reservation or payment decisions.

## ANTI-PATTERNS

- Do not query protected reservation/payment rows directly from client components.
- Do not infer paid/confirmed state from query parameters, Toss redirect values, or client memory.
- Do not call service-role clients, confirm payment, cancel reservations, restore capacity, or
  calculate refunds from these pages.
- Do not collapse mismatch or provider/internal reconciliation states into a success screen.

## VERIFY

```bash
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:reservations
corepack pnpm test:api:contracts
corepack pnpm typecheck
```
