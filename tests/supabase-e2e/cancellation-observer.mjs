import assert from "node:assert/strict"
import postgres from "postgres"

import { fixedIds } from "./fixtures.mjs"

export function createCancellationObserver(status) {
  return postgres(status.dbUrl, { max: 1, idle_timeout: 1 })
}

export async function readCancellationState(sql) {
  const [state] = await sql`
    select
      (select row_to_json(row) from (
        select id::text, status::text,
          to_char(cancelled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')
            as cancelled_at,
          cancellation_reason
        from public.reservations where id = ${fixedIds.cancellableReservation}
      ) row) as reservation,
      (select reserved_count from public.lesson_schedules
        where id = ${fixedIds.baselineOpenSchedule}) as reserved_count,
      (select count(*)::int from public.refunds
        where reservation_id = ${fixedIds.cancellableReservation}
          and source = 'reservation_cancellation') as refund_count,
      (select row_to_json(row) from (
        select id::text, amount, status::text
        from public.refunds
        where reservation_id = ${fixedIds.cancellableReservation}
          and source = 'reservation_cancellation'
      ) row) as refund,
      (select count(*)::int from public.notifications
        where data->>'reservationId' = ${fixedIds.cancellableReservation}) as notification_count,
      (select count(*)::int from public.audit_logs
        where target_id = ${fixedIds.cancellableReservation}
          and action = 'reservation.cancelled') as audit_count
  `
  return normalizeState(state)
}

export function assertPristineState(state) {
  assert.equal(state.reservation.status, "confirmed")
  assert.equal(state.reservation.cancelled_at, null)
  assert.equal(state.reservation.cancellation_reason, null)
  assert.equal(state.reserved_count, 1)
  assert.equal(state.refund_count, 0)
  assert.equal(state.refund, null)
  assert.equal(state.notification_count, 0)
  assert.equal(state.audit_count, 0)
}

export function assertCancelledState(state, { reason, response }) {
  assert.equal(state.reservation.status, "cancelled_by_user")
  assert.equal(state.reservation.cancellation_reason, reason)
  assert.equal(
    new Date(state.reservation.cancelled_at).getTime(),
    new Date(response.data.cancelledAt).getTime(),
  )
  assert.equal(state.reserved_count, 0)
  assert.equal(state.refund_count, 1)
  assert.equal(state.refund.id, response.data.refund.id)
  assert.equal(state.refund.amount, 7000)
  assert.equal(state.refund.status, "requested")
  assert.equal(state.notification_count, 1)
  assert.equal(state.audit_count, 1)
}

function normalizeState(state) {
  return {
    ...state,
    reservation: state.reservation,
  }
}
