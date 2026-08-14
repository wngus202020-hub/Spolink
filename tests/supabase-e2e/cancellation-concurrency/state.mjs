import assert from "node:assert/strict"
import postgres from "postgres"

export function createRaceObserver(status) {
  return postgres(withApplicationName(status.dbUrl, "spolink-todo7-observer"), {
    idle_timeout: 1,
    max: 1,
  })
}

export async function restoreRaceSlot(sql, provision, slot) {
  const schedule = findRow(provision.rows.schedules, slot.scheduleId)
  const reservation = findRow(provision.rows.reservations, slot.reservationId)
  const payment = findRow(provision.rows.payments, slot.paymentId)
  const profileIds = Object.values(provision.authIds)
  await sql.begin(async (tx) => {
    await removeSideEffects(tx, slot, profileIds)
    await assertNoSideEffects(tx, slot, profileIds)
    await tx`
      update public.lesson_schedules set starts_at = ${schedule.starts_at},
        ends_at = ${schedule.ends_at}, capacity = ${schedule.capacity},
        reserved_count = ${schedule.reserved_count}, is_open = ${schedule.is_open}
      where id = ${slot.scheduleId}
    `
    await tx`
      update public.reservations set status = ${reservation.status},
        payment_expires_at = ${reservation.payment_expires_at},
        confirmed_at = ${reservation.confirmed_at}, cancelled_at = null,
        cancellation_reason = null, completed_at = null, no_show_marked_at = null,
        dispute_reason = null, learner_id = ${reservation.learner_id},
        coach_profile_id = ${reservation.coach_profile_id}
      where id = ${slot.reservationId}
    `
    await tx`
      update public.payments set status = ${payment.status},
        provider_payment_key = ${payment.provider_payment_key},
        approved_at = ${payment.approved_at}, failed_reason = null,
        raw_payload = ${payment.raw_payload}, amount = ${payment.amount}
      where id = ${slot.paymentId}
    `
  })
}

export async function readRaceState(sql, slot) {
  const [state] = await sql`
    select
      (select row_to_json(row) from (
        select id::text, status::text, cancellation_reason,
          cancelled_at is not null as cancelled, confirmed_at is not null as confirmed
        from public.reservations where id = ${slot.reservationId}
      ) row) as reservation,
      (select row_to_json(row) from (
        select id::text, status::text, provider_order_id, provider_payment_key,
          amount, approved_at is not null as approved, failed_reason, raw_payload
        from public.payments where id = ${slot.paymentId}
      ) row) as payment,
      (select reserved_count from public.lesson_schedules where id = ${slot.scheduleId})
        as reserved_count,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.source, row.amount), '[]')
       from (
        select amount, reason, source::text, status::text
        from public.refunds where reservation_id = ${slot.reservationId}
      ) row) as refunds,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.type, row.user_id::text), '[]')
       from (
        select user_id::text, type, data->>'status' as status
        from public.notifications where data->>'reservationId' = ${slot.reservationId}
      ) row) as notifications,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.action, row.target_type), '[]')
       from (
        select action, target_type, target_id::text,
          after_data->>'refundSource' as refund_source,
          nullif(after_data->>'refundAmount', '')::int as refund_amount
        from public.audit_logs
        where target_id in (${slot.reservationId}, ${slot.paymentId})
      ) row) as audits
  `
  return state
}

export function assertCounts(state, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(countBy(state, key), value, key)
  }
}

export function assertRaceStateSnapshot(state, expected) {
  assert.deepEqual(normalizeState(state), expected)
}

function normalizeState(state) {
  return {
    audits: state.audits,
    notifications: state.notifications.map(({ status, type }) => ({ status, type })),
    payment: state.payment,
    refunds: state.refunds,
    reservation: state.reservation,
    reserved_count: state.reserved_count,
  }
}

function countBy(state, key) {
  if (key === "cancellationRefunds")
    return state.refunds.filter((row) => row.source === "reservation_cancellation").length
  if (key === "reconciliationRefunds")
    return state.refunds.filter((row) => row.source === "payment_confirmation_reconciliation")
      .length
  if (key === "cancelNotifications")
    return state.notifications.filter((row) => row.type === "reservation_cancelled").length
  if (key === "confirmNotifications")
    return state.notifications.filter((row) => row.type === "reservation_confirmed").length
  if (key === "cancelAudits")
    return state.audits.filter((row) => row.action === "reservation.cancelled").length
  if (key === "confirmAudits")
    return state.audits.filter((row) => row.action === "payment.confirmed").length
  if (key === "reconciliationAudits")
    return state.audits.filter(
      (row) => row.action === "payment.confirmation_reconciliation_required",
    ).length
  throw new Error(`Unknown count key: ${key}`)
}

async function removeSideEffects(sql, slot, profileIds) {
  await sql`delete from public.audit_logs where target_id in (${slot.reservationId}, ${slot.paymentId}) or actor_id in ${sql(profileIds)}`
  await sql`delete from public.notifications where user_id in ${sql(profileIds)} or data->>'reservationId' = ${slot.reservationId}`
  await sql`delete from public.refunds where reservation_id = ${slot.reservationId} or payment_id = ${slot.paymentId}`
}

async function assertNoSideEffects(sql, slot, profileIds) {
  const [row] = await sql`
    select
      (select count(*)::int from public.refunds where reservation_id = ${slot.reservationId}
        or payment_id = ${slot.paymentId}) as refunds,
      (select count(*)::int from public.notifications where user_id in ${sql(profileIds)}
        and data->>'reservationId' = ${slot.reservationId}) as notifications,
      (select count(*)::int from public.audit_logs where target_id in (${slot.reservationId}, ${slot.paymentId})) as audits
  `
  assert.deepEqual(row, { audits: 0, notifications: 0, refunds: 0 })
}

function findRow(rows, id) {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`Missing fixture row: ${id}`)
  return row
}

function withApplicationName(dbUrl, applicationName) {
  const url = new URL(dbUrl)
  url.searchParams.set("application_name", applicationName)
  return url.toString()
}
