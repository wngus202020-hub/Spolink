import postgres from "postgres"

import { fixedIds } from "../fixtures.mjs"

export function createObserver(status) {
  return postgres(status.dbUrl, { max: 1, idle_timeout: 1 })
}

export async function readBaselineSnapshot(sql) {
  const [snapshot] = await sql`
    select
      (select row_to_json(row)
        from (
          select id::text, status::text, cancellation_reason
          from public.reservations
          where id = ${fixedIds.historyReservation}
        ) row) as history_reservation,
      (select row_to_json(row)
        from (
          select id::text, status::text, failed_reason
          from public.payments
          where id = ${fixedIds.historyPayment}
        ) row) as history_payment,
      (select row_to_json(row)
        from (
          select id::text, reason, status::text
          from public.refunds
          where id = ${fixedIds.historyRefund}
        ) row) as history_refund,
      (select row_to_json(row)
        from (
          select id::text, starts_at, ends_at, capacity, reserved_count, is_open
          from public.lesson_schedules
          where id = ${fixedIds.baselineOpenSchedule}
        ) row) as open_schedule,
      (select row_to_json(row)
        from (
          select id::text, starts_at, ends_at, capacity, reserved_count, is_open
          from public.lesson_schedules
          where id = ${fixedIds.baselineClosedSchedule}
        ) row) as closed_schedule,
      (select row_to_json(row)
        from (
          select id::text, status::text, payment_expires_at, confirmed_at, cancelled_at,
            cancellation_reason
          from public.reservations
          where id = ${fixedIds.cancellableReservation}
        ) row) as cancellable_reservation,
      (select row_to_json(row)
        from (
          select id::text, status::text, approved_at, failed_reason, provider_payment_key,
            raw_payload
          from public.payments
          where id = ${fixedIds.cancellablePayment}
        ) row) as cancellable_payment
  `
  return snapshot
}

export async function restoreDirectWriteBaselines(sql, snapshot) {
  await sql`
    update public.reservations set
      status = ${snapshot.history_reservation.status},
      cancellation_reason = ${snapshot.history_reservation.cancellation_reason}
    where id = ${fixedIds.historyReservation}
  `
  await restoreSchedule(sql, fixedIds.baselineOpenSchedule, snapshot.open_schedule)
  await restoreSchedule(sql, fixedIds.baselineClosedSchedule, snapshot.closed_schedule)
}

export async function restoreCancellableBaseline(sql, snapshot) {
  await sql`
    delete from public.refunds
    where reservation_id = ${fixedIds.cancellableReservation}
      and source = 'reservation_cancellation'
  `
  await sql`
    delete from public.notifications
    where data->>'reservationId' = ${fixedIds.cancellableReservation}
  `
  await sql`
    delete from public.audit_logs
    where target_id = ${fixedIds.cancellableReservation}
       or after_data->>'refundId' in (
         select id::text from public.refunds
         where reservation_id = ${fixedIds.cancellableReservation}
       )
  `
  await restoreSchedule(sql, fixedIds.baselineOpenSchedule, snapshot.open_schedule)
  await sql`
    update public.reservations set
      status = ${snapshot.cancellable_reservation.status},
      payment_expires_at = ${snapshot.cancellable_reservation.payment_expires_at},
      confirmed_at = ${snapshot.cancellable_reservation.confirmed_at},
      cancelled_at = ${snapshot.cancellable_reservation.cancelled_at},
      cancellation_reason = ${snapshot.cancellable_reservation.cancellation_reason}
    where id = ${fixedIds.cancellableReservation}
  `
  await sql`
    update public.payments set
      status = ${snapshot.cancellable_payment.status},
      approved_at = ${snapshot.cancellable_payment.approved_at},
      failed_reason = ${snapshot.cancellable_payment.failed_reason},
      provider_payment_key = ${snapshot.cancellable_payment.provider_payment_key},
      raw_payload = ${snapshot.cancellable_payment.raw_payload}
    where id = ${fixedIds.cancellablePayment}
  `
}

export async function readCancellationObserverState(sql) {
  const [state] = await sql`
    select
      (select status::text from public.reservations where id = ${fixedIds.cancellableReservation})
        as reservation_status,
      (select cancelled_at is not null from public.reservations
        where id = ${fixedIds.cancellableReservation}) as has_cancelled_at,
      (select cancellation_reason from public.reservations
        where id = ${fixedIds.cancellableReservation}) as cancellation_reason,
      (select reserved_count from public.lesson_schedules
        where id = ${fixedIds.baselineOpenSchedule}) as reserved_count,
      (select count(*)::int from public.refunds
        where reservation_id = ${fixedIds.cancellableReservation}
          and source = 'reservation_cancellation'
          and amount = 7000
          and status = 'requested') as cancellation_refunds,
      (select count(*)::int from public.notifications
        where data->>'reservationId' = ${fixedIds.cancellableReservation}) as notifications,
      (select count(*)::int from public.audit_logs
        where target_id = ${fixedIds.cancellableReservation}
          and action = 'reservation.cancelled') as audit_logs
  `
  return state
}

async function restoreSchedule(sql, id, row) {
  await sql`
    update public.lesson_schedules set
      starts_at = ${row.starts_at},
      ends_at = ${row.ends_at},
      capacity = ${row.capacity},
      reserved_count = ${row.reserved_count},
      is_open = ${row.is_open}
    where id = ${id}
  `
}
