import assert from "node:assert/strict"

import { fixedIds } from "../fixtures.mjs"

export const timestampMarker = "<timestamp>"

export function expectedSelectSnapshot({ persona, authIds, epoch }) {
  const visibleHistory = ["learner", "coach", "admin"].includes(persona)
  const privilegedSchedule = ["coach", "admin"].includes(persona)
  return {
    reservations: visibleHistory ? [historyReservation(authIds, epoch)] : [],
    schedules: privilegedSchedule
      ? [openSchedule(epoch), closedSchedule(epoch)]
      : [openSchedule(epoch)],
    payments: visibleHistory ? [historyPayment(authIds, epoch)] : [],
    refunds: visibleHistory ? [historyRefund(authIds)] : [],
    paymentPermissionDenied: persona === "anonymous",
  }
}

export function normalizeRows(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, normalizeValue(key, value)]),
    ),
  )
}

export function assertSnapshotRows(name, table, actualRows, expectedRows) {
  assert.deepEqual(normalizeRows(actualRows), expectedRows, `${name} ${table} exact snapshot`)
}

export function assertSnapshotRejectsRepresentativeMutations({ authIds, epoch }) {
  const snapshot = expectedSelectSnapshot({ persona: "learner", authIds, epoch })
  assertRejectsFieldMutation("reservation status", snapshot.reservations, "status", "confirmed")
  assertRejectsFieldMutation("payment amount", snapshot.payments, "amount", 9999)
  assertRejectsFieldMutation("refund reason", snapshot.refunds, "reason", "mutated")
  assertRejectsFieldMutation("schedule reserved_count", snapshot.schedules, "reserved_count", 0)
}

function assertRejectsFieldMutation(name, rows, key, value) {
  const mutated = [{ ...materializeActualRows(rows)[0], [key]: value }]
  assert.throws(
    () => assertSnapshotRows(`mutation probe ${name}`, name, mutated, rows),
    /exact snapshot/,
  )
}

function materializeActualRows(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value === timestampMarker ? "2026-07-17T00:00:00.000Z" : value,
      ]),
    ),
  )
}

function historyReservation(authIds, epoch) {
  return {
    id: fixedIds.historyReservation,
    lesson_id: fixedIds.lesson,
    lesson_schedule_id: fixedIds.baselineClosedSchedule,
    learner_id: authIds.learner,
    coach_profile_id: fixedIds.approvedCoachProfile,
    status: "cancelled_by_user",
    reserved_price_amount: 10001,
    payment_expires_at: null,
    confirmed_at: toIso(epoch),
    cancelled_at: toIso(epoch),
    cancellation_reason: "E2E historical cancellation",
    completed_at: null,
    no_show_marked_at: null,
    dispute_reason: null,
    created_at: timestampMarker,
    updated_at: timestampMarker,
  }
}

function historyPayment(authIds, epoch) {
  return {
    id: fixedIds.historyPayment,
    reservation_id: fixedIds.historyReservation,
    payer_id: authIds.learner,
    status: "paid",
    provider: "toss",
    provider_order_id: `spolink_${fixedIds.historyReservation}`,
    amount: 10001,
    approved_at: toIso(epoch),
    failed_reason: null,
    created_at: timestampMarker,
    updated_at: timestampMarker,
  }
}

function historyRefund(authIds) {
  return {
    id: fixedIds.historyRefund,
    payment_id: fixedIds.historyPayment,
    reservation_id: fixedIds.historyReservation,
    requested_by: authIds.learner,
    amount: 1,
    reason: "E2E manual visibility refund",
    source: "manual",
    status: "requested",
    processed_at: null,
    created_at: timestampMarker,
    updated_at: timestampMarker,
  }
}

function openSchedule(epoch) {
  return scheduleRow({
    id: fixedIds.baselineOpenSchedule,
    startsAt: addHours(epoch, 25),
    endsAt: addHours(epoch, 26),
    reservedCount: 1,
    isOpen: true,
  })
}

function closedSchedule(epoch) {
  return scheduleRow({
    id: fixedIds.baselineClosedSchedule,
    startsAt: addHours(epoch, 48),
    endsAt: addHours(epoch, 49),
    reservedCount: 0,
    isOpen: false,
  })
}

function scheduleRow({ id, startsAt, endsAt, reservedCount, isOpen }) {
  return {
    id,
    lesson_id: fixedIds.lesson,
    starts_at: startsAt,
    ends_at: endsAt,
    capacity: 2,
    reserved_count: reservedCount,
    is_open: isOpen,
    created_at: timestampMarker,
    updated_at: timestampMarker,
  }
}

function normalizeValue(key, value) {
  if (value === null) return null
  if (key === "created_at" || key === "updated_at") {
    assertTimestamp(value, key)
    return timestampMarker
  }
  if (key.endsWith("_at") || key === "starts_at" || key === "ends_at") {
    return toIso(value)
  }
  return value
}

function addHours(epoch, hours) {
  return new Date(new Date(epoch).getTime() + hours * 60 * 60 * 1000).toISOString()
}

function toIso(value) {
  return new Date(value).toISOString()
}

function assertTimestamp(value, key) {
  assert.equal(Number.isNaN(Date.parse(value)), false, `${key} must be parseable timestamp`)
}
