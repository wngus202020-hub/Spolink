import assert from "node:assert/strict"

import { fixedIds } from "../fixtures.mjs"
import { assertMutationDenied } from "./select-matrix.mjs"

export async function assertReservationWriteCell({ name, client, allowed }) {
  const result = await client
    .from("reservations")
    .update({ cancellation_reason: `Todo4 ${name}` })
    .eq("id", fixedIds.historyReservation)
    .select("id,cancellation_reason")

  if (!allowed) {
    assertMutationDenied(name, result)
    return
  }

  assert.ifError(result.error)
  assert.equal(result.data.length, 1, `${name} updated reservation`)
  assert.equal(result.data[0].cancellation_reason, `Todo4 ${name}`)
}

export async function assertPaymentRefundWriteDenied({ name, client }) {
  const payment = await client
    .from("payments")
    .update({ failed_reason: `Todo4 ${name}` })
    .eq("id", fixedIds.historyPayment)
    .select("id")
  assertMutationDenied(`${name} payments`, payment)

  const refund = await client
    .from("refunds")
    .update({ reason: `Todo4 ${name}` })
    .eq("id", fixedIds.historyRefund)
    .select("id")
  assertMutationDenied(`${name} refunds`, refund)
}

export async function assertScheduleOrdinaryWriteCell({ name, client, allowed }) {
  const result = await client
    .from("lesson_schedules")
    .update({ capacity: 3 })
    .eq("id", fixedIds.baselineClosedSchedule)
    .select("id,capacity")

  if (!allowed) {
    assertMutationDenied(name, result)
    return
  }

  assert.ifError(result.error)
  assert.equal(result.data.length, 1, `${name} updated schedule`)
  assert.equal(result.data[0].capacity, 3)
}

export async function assertScheduleReservedCountCell({ name, client, allowed }) {
  const result = await client
    .from("lesson_schedules")
    .update({ reserved_count: 0 })
    .eq("id", fixedIds.baselineOpenSchedule)
    .select("id,reserved_count")

  if (!allowed) {
    assertMutationDenied(name, result)
    return
  }

  assert.ifError(result.error)
  assert.equal(result.data.length, 1, `${name} updated reserved_count`)
  assert.equal(result.data[0].reserved_count, 0)
}
