# PAYMENT DOMAIN GUIDE

## SCOPE

`payments/` owns payment preparation, trusted confirmation, provider verification,
reconciliation recording, and payment-page classification for a reservation.

## FLOW MAP

| Stage | Files | Required result |
|---|---|---|
| Prepare | `prepare-payment-api.ts`, `payment-prepare-client.ts` | one `ready` Toss payment for an eligible learner reservation |
| Render | `payment-page-{read,state,view-model,data,types}.ts` | explicit state; no inferred success |
| Confirm | `confirm-payment-api.ts`, `toss-payment-verifier.ts` | verified provider evidence before `confirm_paid_reservation` |
| Trusted ingress | `edge-auth.ts`, `app/api/payments/confirm/route.ts` | exact Edge bearer secret, service-role boundary |
| Reconcile | confirm workflow + confirmation RPCs | retain provider evidence before follow-up action |

## PREPARE VS CONFIRM

- Prepare is learner-session work: it creates or returns a `ready` payment through `create_ready_payment`.
- Prepare does not charge, mark paid, or accept a provider payment key.
- Confirm accepts `reservationId`, amount, provider order ID, and provider payment key only at the trusted route.
- Confirm verifies Toss `DONE` status and key/order/amount agreement before internal paid-state RPC work.
- Browser clients call prepare; they never call the service-role confirmation path or receive provider secrets.

## CONFIRMATION AND RECONCILIATION

- `runConfirmPaymentWorkflow` calls `verifyProviderPayment` before `confirmPaidReservation`.
- Verification failure records the failure where applicable; provider transport failure remains an external-provider error.
- A verified provider result that SQL cannot apply first records `mark_payment_confirmation_reconciliation_required`.
- Preserve raw provider evidence in the reconciliation record; do not cancel, refund, or overwrite it in application code.
- Reconciliation is the source for later compensating refund requests when provider success and reservation state diverge.
- Actual provider refund execution and payout execution remain deferred; only internal request/reconciliation states exist here.

## PAYMENT PAGE STATES

- `pending_valid` means a learner-owned `pending_payment` reservation is still unexpired and has no payment.
- `ready` additionally requires a `ready` Toss payment; `confirmed` requires reservation `confirmed` plus payment `paid`.
- Keep `expired_pending`, `terminal`, `unavailable`, `not_found`, and `read_failure` separate for rendering and recovery.
- The ownership query precedes service-role lesson/schedule enrichment in `payment-page-read.ts`.

## VERIFY

```bash
node --test tests/payment-*.test.mjs tests/payments-api.test.mjs tests/toss-payment-verifier.test.mjs
corepack pnpm test:e2e:payment
corepack pnpm test:e2e:supabase
```
