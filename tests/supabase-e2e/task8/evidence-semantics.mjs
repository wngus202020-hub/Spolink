import assert from "node:assert/strict"
import { createHash } from "node:crypto"

import { fixedIds } from "../fixtures.mjs"
import {
  assertCancellationBody,
  assertConfiguredBody,
  assertUnauthorizedBody,
} from "./qa-assertions.mjs"

const shaPattern = /^[a-f0-9]{64}$/

export function assertTask8QaProof(proof) {
  const { summary, configured, unauthorized, cancellation, pristine, cancelled } = proof
  assert.equal(summary.status, "SUCCESS")
  assert.equal(summary.qaCommand, "Todo8 exact QA-hold shell command")
  assert.equal(summary.metadata.externalFilesValidated, true)
  assertHttp(configured, 200, summary.configured, assertConfiguredBody)
  assertHttp(unauthorized, 401, summary.unauthenticatedCancellation, assertUnauthorizedBody)
  assertHttp(cancellation, 200, summary.authenticatedCancellation, (body) =>
    assertCancellationBody(
      body,
      fixedIds.cancellableReservation,
      "cancelled_by_user",
      7000,
      "requested",
    ),
  )
  assertDb(pristine, summary.db.pristine)
  assertDb(cancelled, summary.db.cancelled)
  assert.equal(summary.cleanup.sha256, proof.cleanupSha256)
  assert.equal(cancellation.transport, "curl -b")
  assert.equal(summary.authenticatedCancellation.transport, "curl -b")
  assert.match(proof.cleanupSha256, shaPattern)
  assertPristine(pristine.snapshot)
  assertCancelled(cancelled.snapshot, cancellation.body)
}

function assertHttp(record, status, summary, assertBody) {
  assert.equal(record.status, status)
  assert.equal(summary.status, status)
  assertBody(record.body)
  const bodySha256 = sha256(JSON.stringify(record.body))
  assert.equal(record.bodySha256, bodySha256)
  assert.equal(summary.bodySha256, bodySha256)
}

function assertDb(record, summary) {
  assert.match(record.querySha256, shaPattern)
  assert.equal(record.resultSha256, sha256(JSON.stringify(record.snapshot)))
  assert.deepEqual(summary, {
    querySha256: record.querySha256,
    resultSha256: record.resultSha256,
  })
}

function assertPristine(state) {
  assert.equal(state.reservation.id, fixedIds.cancellableReservation)
  assert.equal(state.reservation.status, "confirmed")
  assert.equal(state.schedule.id, fixedIds.baselineOpenSchedule)
  assert.equal(state.schedule.reserved_count, 1)
  assert.equal(state.payment.id, fixedIds.cancellablePayment)
  assert.equal(state.payment.status, "paid")
  assertRedactedPaymentEvidence(state.payment)
  assert.deepEqual(state.refunds, [])
  assert.deepEqual(state.notifications, [])
  assert.deepEqual(state.audits, [])
}

function assertCancelled(state, body) {
  assert.equal(state.reservation.id, fixedIds.cancellableReservation)
  assert.equal(state.reservation.status, "cancelled_by_user")
  assert.equal(state.reservation.cancelled_at, body.data.cancelledAt)
  assert.equal(state.reservation.cancellation_reason, "QA authenticated")
  assert.equal(state.schedule.id, fixedIds.baselineOpenSchedule)
  assert.equal(state.schedule.reserved_count, 0)
  assert.equal(state.payment.id, fixedIds.cancellablePayment)
  assert.equal(state.payment.status, "paid")
  assert.equal(state.payment.provider, "toss")
  assert.equal(state.payment.amount, 10001)
  assertRedactedPaymentEvidence(state.payment)
  assert.equal(state.refunds.length, 1)
  assert.equal(state.refunds[0].id, body.data.refund.id)
  assert.equal(state.refunds[0].amount, 7000)
  assert.equal(state.refunds[0].status, "requested")
  assert.equal(state.refunds[0].source, "reservation_cancellation")
  assert.deepEqual(state.notifications, [
    { status: "cancelled_by_user", type: "reservation_cancelled", user_id: "coach" },
  ])
  assert.equal(state.audits.length, 1)
  assert.equal(state.audits[0].action, "reservation.cancelled")
}

function assertRedactedPaymentEvidence(payment) {
  assert.equal(payment.provider_order_id, "<redacted>")
  assert.match(payment.provider_order_id_sha256, shaPattern)
  assert.equal(payment.provider_payment_key, "<redacted>")
  assert.equal(payment.provider_payment_key_present, true)
  assert.match(payment.provider_payment_key_sha256, shaPattern)
  assert.equal(payment.raw_payload.orderId, "<redacted>")
  assert.match(payment.raw_payload.orderIdSha256, shaPattern)
  assert.equal(payment.raw_payload.paymentKey, "<redacted>")
  assert.match(payment.raw_payload.paymentKeySha256, shaPattern)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
