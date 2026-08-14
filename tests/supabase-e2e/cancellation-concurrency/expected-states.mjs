import { providerEvidence } from "./slots.mjs"
import { assertRaceStateSnapshot } from "./state.mjs"

export function assertCancelledState(state, slot, reason) {
  assertRaceStateSnapshot(state, expectedCancelledState(slot, reason))
}

export function assertConfirmedThenCancelledState(state, slot, reason) {
  assertRaceStateSnapshot(state, {
    ...expectedCancelledState(slot, reason),
    audits: [
      confirmedAudit(slot),
      {
        action: "reservation.cancelled",
        refund_amount: 7000,
        refund_source: null,
        target_id: slot.reservationId,
        target_type: "reservation",
      },
    ],
    notifications: [
      { status: "cancelled_by_user", type: "reservation_cancelled" },
      { status: null, type: "reservation_confirmed" },
    ],
    payment: {
      ...expectedPaidPayment(slot),
      provider_payment_key: slot.providerKey,
      raw_payload: providerEvidence(slot),
    },
  })
}

export function assertReconciledCancellationState(state, slot, reason) {
  assertRaceStateSnapshot(state, {
    ...expectedCancelledState(slot, reason),
    audits: [
      {
        action: "payment.confirmation_reconciliation_required",
        refund_amount: 10001,
        refund_source: "payment_confirmation_reconciliation",
        target_id: slot.paymentId,
        target_type: "payment",
      },
      {
        action: "reservation.cancelled",
        refund_amount: null,
        refund_source: null,
        target_id: slot.reservationId,
        target_type: "reservation",
      },
    ],
    payment: {
      ...expectedPaidPayment(slot),
      failed_reason:
        "confirmation_reconciliation_required:RESERVATION_CANCELLED_AFTER_PROVIDER_APPROVAL",
      provider_payment_key: slot.providerKey,
      raw_payload: providerEvidence(slot),
    },
    refunds: [
      {
        amount: 10001,
        reason: "Provider payment confirmed after reservation cancellation.",
        source: "payment_confirmation_reconciliation",
        status: "requested",
      },
    ],
    reservation: { ...expectedCancelledState(slot, reason).reservation, confirmed: false },
  })
}

function expectedCancelledState(slot, reason) {
  return {
    audits: [
      {
        action: "reservation.cancelled",
        refund_amount: 7000,
        refund_source: null,
        target_id: slot.reservationId,
        target_type: "reservation",
      },
    ],
    notifications: [{ status: "cancelled_by_user", type: "reservation_cancelled" }],
    payment: expectedPaidPayment(slot),
    refunds: [{ amount: 7000, reason, source: "reservation_cancellation", status: "requested" }],
    reservation: {
      cancelled: true,
      cancellation_reason: reason,
      confirmed: true,
      id: slot.reservationId,
      status: "cancelled_by_user",
    },
    reserved_count: 0,
  }
}

function expectedPaidPayment(slot) {
  return {
    amount: 10001,
    approved: true,
    failed_reason: null,
    id: slot.paymentId,
    provider_order_id: `spolink_${slot.reservationId}`,
    provider_payment_key: `local-seed-${slot.reservation}`,
    raw_payload: {
      orderId: `spolink_${slot.reservationId}`,
      paymentKey: `local-seed-${slot.reservation}`,
      status: "DONE",
      totalAmount: 10001,
    },
    status: "paid",
  }
}

function confirmedAudit(slot) {
  return {
    action: "payment.confirmed",
    refund_amount: null,
    refund_source: null,
    target_id: slot.paymentId,
    target_type: "payment",
  }
}
