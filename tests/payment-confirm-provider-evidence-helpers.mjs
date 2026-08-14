import assert from "node:assert/strict"
import { selectOne } from "./payment-confirm-sql-assertions.mjs"
import {
  providerOrderId,
  providerPaymentKey,
  reservationId,
} from "./payment-confirm-sql-test-helpers.mjs"

export const validConfirmProviderPayload = {
  orderId: providerOrderId,
  paymentKey: providerPaymentKey,
  status: "DONE",
  totalAmount: 50000,
}

export const invalidConfirmProviderPayloadCases = [
  ["missing orderId", withoutKey("orderId")],
  ["mismatched orderId", { ...validConfirmProviderPayload, orderId: "spolink_mismatch" }],
  ["missing paymentKey", withoutKey("paymentKey")],
  ["mismatched paymentKey", { ...validConfirmProviderPayload, paymentKey: "wrong-key" }],
  ["missing status", withoutKey("status")],
  ["non-DONE status", { ...validConfirmProviderPayload, status: "CANCELED" }],
  ["missing totalAmount", withoutKey("totalAmount")],
  ["non-numeric totalAmount", { ...validConfirmProviderPayload, totalAmount: true }],
  ["string totalAmount", { ...validConfirmProviderPayload, totalAmount: "50000" }],
  ["fractional totalAmount", { ...validConfirmProviderPayload, totalAmount: 50000.5 }],
  ["negative totalAmount", { ...validConfirmProviderPayload, totalAmount: -1 }],
  ["overflow totalAmount", { ...validConfirmProviderPayload, totalAmount: 2147483648 }],
]

export async function confirmPaidReservationWithPayload(db, rawPayload) {
  const result = await db.query(
    "select * from public.confirm_paid_reservation($1, $2, $3, $4, $5)",
    [reservationId, providerOrderId, providerPaymentKey, 50000, rawPayload],
  )

  assert.equal(result.rows.length, 1)

  return result.rows[0]
}

export async function assertConfirmProviderEvidenceError(db, rawPayload) {
  await assert.rejects(
    () => confirmPaidReservationWithPayload(db, rawPayload),
    (error) => error.code === "P0007",
  )
}

export async function readConfirmProviderEvidenceState(db) {
  return {
    audit: await selectOne(db, "select count(*)::int as count from public.audit_logs"),
    notification: await selectOne(db, "select count(*)::int as count from public.notifications"),
    payment: await selectOne(
      db,
      `select
        status,
        provider_payment_key,
        approved_at is not null as approved,
        failed_reason,
        raw_payload
      from public.payments`,
    ),
    reservation: await selectOne(
      db,
      `select
        status,
        confirmed_at is not null as confirmed,
        payment_expires_at is not null as expires_set
      from public.reservations`,
    ),
    schedule: await selectOne(db, "select reserved_count from public.lesson_schedules"),
  }
}

function withoutKey(key) {
  const payload = { ...validConfirmProviderPayload }
  delete payload[key]
  return payload
}
