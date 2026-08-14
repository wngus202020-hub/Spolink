import assert from "node:assert/strict"

import { fixedIds } from "../fixtures.mjs"
import { assertSnapshotRows } from "./snapshots.mjs"

export const reservationColumns = [
  "id",
  "lesson_id",
  "lesson_schedule_id",
  "learner_id",
  "coach_profile_id",
  "status",
  "reserved_price_amount",
  "payment_expires_at",
  "confirmed_at",
  "cancelled_at",
  "cancellation_reason",
  "completed_at",
  "no_show_marked_at",
  "dispute_reason",
  "created_at",
  "updated_at",
]

export const scheduleColumns = [
  "id",
  "lesson_id",
  "starts_at",
  "ends_at",
  "capacity",
  "reserved_count",
  "is_open",
  "created_at",
  "updated_at",
]

export const paymentColumns = [
  "id",
  "reservation_id",
  "payer_id",
  "status",
  "provider",
  "provider_order_id",
  "amount",
  "approved_at",
  "failed_reason",
  "created_at",
  "updated_at",
]

export const refundColumns = [
  "id",
  "payment_id",
  "reservation_id",
  "requested_by",
  "amount",
  "reason",
  "source",
  "status",
  "processed_at",
  "created_at",
  "updated_at",
]

export async function assertSelectCell({ name, client, expected }) {
  const reservations = await client
    .from("reservations")
    .select(reservationColumns.join(","))
    .eq("id", fixedIds.historyReservation)
  assertNoError(name, "reservations", reservations.error)
  assertSnapshotRows(name, "reservations", reservations.data, expected.reservations)

  const schedules = await client
    .from("lesson_schedules")
    .select(scheduleColumns.join(","))
    .in("id", [fixedIds.baselineOpenSchedule, fixedIds.baselineClosedSchedule])
    .order("id")
  assertNoError(name, "lesson_schedules", schedules.error)
  assertSnapshotRows(name, "lesson_schedules", schedules.data, expected.schedules)

  const payments = await client
    .from("payments")
    .select(paymentColumns.join(","))
    .eq("id", fixedIds.historyPayment)
  const refunds = await client
    .from("refunds")
    .select(refundColumns.join(","))
    .eq("id", fixedIds.historyRefund)

  if (expected.paymentPermissionDenied) {
    assertPermissionDenied(name, "payments", payments)
    assertPermissionDenied(name, "refunds", refunds)
    return
  }

  assertNoError(name, "payments", payments.error)
  assertNoError(name, "refunds", refunds.error)
  assertGrantedPaymentColumns(name, payments.data)
  assertGrantedRefundColumns(name, refunds.data)
  assertSnapshotRows(name, "payments", payments.data, expected.payments)
  assertSnapshotRows(name, "refunds", refunds.data, expected.refunds)
}

export function assertPermissionDenied(name, table, result) {
  assert.equal(result.data, null, `${name} ${table} denied data`)
  assert.equal(result.error?.code, "42501", `${name} ${table} denied code`)
  assert.match(result.error?.message ?? "", /permission denied/i, `${name} ${table} message`)
}

export function assertMutationDenied(name, result) {
  if (result.error) {
    assert.equal(result.error.code, "42501", `${name} denied code`)
    assert.match(result.error.message, /permission denied|trusted/i, `${name} denied message`)
    return { mode: "error", code: result.error.code, message: result.error.message }
  }
  assert.deepEqual(result.data ?? [], [], `${name} denied rows`)
  return { mode: "rls-zero-rows" }
}

function assertGrantedPaymentColumns(name, rows) {
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), paymentColumns.toSorted(), `${name} payment columns`)
    assert.equal(Object.hasOwn(row, "provider_payment_key"), false, `${name} no payment key`)
    assert.equal(Object.hasOwn(row, "raw_payload"), false, `${name} no raw payload`)
  }
}

function assertGrantedRefundColumns(name, rows) {
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), refundColumns.toSorted(), `${name} refund columns`)
    assert.equal(Object.hasOwn(row, "provider_refund_key"), false, `${name} no refund key`)
    assert.equal(Object.hasOwn(row, "raw_payload"), false, `${name} no raw payload`)
  }
}

function assertNoError(name, table, error) {
  if (error) {
    assert.fail(`${name} ${table} unexpected error: ${error.code} ${error.message}`)
  }
}
