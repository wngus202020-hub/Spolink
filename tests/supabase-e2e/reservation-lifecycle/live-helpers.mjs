import assert from "node:assert/strict"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"
import { createPersonaClients, signInPersonas } from "../auth-rls/clients.mjs"
import { createDatabaseBarrier } from "../database-barrier.mjs"
import { fixtureUsers } from "../fixtures.mjs"

export async function createLifecycleRuntime(status, password) {
  const clients = createPersonaClients(status)
  await signInPersonas(clients, password)
  const sql = postgres(withApplicationName(status.dbUrl, "spolink-todo3-observer"), {
    idle_timeout: 1,
    max: 2,
  })
  const serviceClient = createClient(status.apiUrl, status.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return {
    barrier: createDatabaseBarrier(status.dbUrl, "spolink-todo3-barrier"),
    clients,
    serviceClient,
    sql,
  }
}

export async function callLifecycle(client, reservationId, action, reason = null) {
  const { data, error } = await client.rpc("transition_reservation_lifecycle", {
    checked_action: action,
    checked_reason: reason,
    checked_reservation_id: reservationId,
  })
  return { data, errorCode: error?.code ?? null, message: error?.message ?? null }
}

export async function callCancellation(client, reservationId, reason) {
  const { data, error } = await client.rpc("cancel_reservation", {
    checked_reason: reason,
    checked_reservation_id: reservationId,
  })
  return { data, errorCode: error?.code ?? null, message: error?.message ?? null }
}

export async function callPayment(serviceClient, slot) {
  const providerPaymentKey = `local-seed-${Number(slot.suffix) + 100}`
  const { data, error } = await serviceClient.rpc("confirm_paid_reservation", {
    checked_amount: 10001,
    checked_provider_order_id: `spolink_${slot.reservationId}`,
    checked_provider_payment_key: providerPaymentKey,
    checked_raw_payload: {
      orderId: `spolink_${slot.reservationId}`,
      paymentKey: providerPaymentKey,
      status: "DONE",
      totalAmount: 10001,
    },
    checked_reservation_id: slot.reservationId,
  })
  return { data, errorCode: error?.code ?? null, message: error?.message ?? null }
}

export async function crossNoShowStatementBoundary({ adminId, reason, sql, target }) {
  return sql.begin(async (tx) => {
    await tx`
      update public.reservations
      set status = 'pending_payment', payment_expires_at = transaction_timestamp() + interval '10 minutes'
      where id = ${target.reservationId}
    `
    await tx`
      update public.lesson_schedules
      set starts_at = transaction_timestamp() - interval '14 minutes 59 seconds',
        ends_at = transaction_timestamp() + interval '45 minutes 1 second'
      where id = ${target.scheduleId}
    `
    await tx`
      update public.reservations
      set status = 'confirmed', payment_expires_at = null
      where id = ${target.reservationId}
    `
    await tx`select set_config(
      'request.jwt.claims',
      ${JSON.stringify({ role: "authenticated", sub: adminId })},
      true
    )`
    await tx`select set_config('request.jwt.claim.sub', ${adminId}, true)`
    await tx`select set_config('request.jwt.claim.role', 'authenticated', true)`
    await tx`set local role authenticated`
    await tx`select pg_sleep(1.25)`
    const [row] = await tx`
      select transaction_timestamp() as transaction_time,
        statement_timestamp() as statement_time,
        schedule.starts_at + interval '15 minutes' as available_at,
        lifecycle.no_show_marked_at,
        lifecycle.reservation_status::text as reservation_status
      from public.lesson_schedules schedule
      cross join lateral public.transition_reservation_lifecycle(
        ${target.reservationId},
        'mark_learner_no_show',
        ${reason}
      ) lifecycle
      where schedule.id = ${target.scheduleId}
    `
    return row
  })
}

export async function restoreSlot(sql, provision, slot) {
  const schedule = provision.rows.schedules.find((row) => row.id === slot.scheduleId)
  const reservation = provision.rows.reservations.find((row) => row.id === slot.reservationId)
  const payment = provision.rows.payments.find((row) => row.id === slot.paymentId)
  assert.ok(schedule && reservation && payment, `missing Todo3 fixture ${slot.suffix}`)
  await sql.begin(async (tx) => {
    await tx`delete from public.settlements where reservation_id = ${slot.reservationId}`
    await tx`delete from public.audit_logs where target_id = ${slot.reservationId}`
    await tx`delete from public.notifications where data->>'reservationId' = ${slot.reservationId}`
    await tx`delete from public.refunds where reservation_id = ${slot.reservationId}`
    await tx`
      update public.reservations
      set status = 'pending_payment', payment_expires_at = now() + interval '10 minutes'
      where id = ${slot.reservationId}
    `
    await tx`
      update public.lesson_schedules
      set starts_at = ${schedule.starts_at}, ends_at = ${schedule.ends_at},
        reserved_count = ${schedule.reserved_count}, is_open = ${schedule.is_open}
      where id = ${slot.scheduleId}
    `
    await tx`
      update public.reservations
      set status = ${reservation.status}, payment_expires_at = ${reservation.payment_expires_at},
        confirmed_at = ${reservation.confirmed_at}, cancelled_at = null,
        cancellation_reason = null, completed_at = null, no_show_marked_at = null,
        dispute_reason = null
      where id = ${slot.reservationId}
    `
    await tx`
      update public.payments
      set status = ${payment.status}, provider_payment_key = ${payment.provider_payment_key},
        approved_at = ${payment.approved_at}, failed_reason = null, raw_payload = ${payment.raw_payload}
      where id = ${slot.paymentId}
    `
  })
}

export async function setScheduleStarts(sql, slot, startsAt) {
  const adjustedStartsAt = new Date(
    Date.parse(startsAt) - (Number(slot.suffix) % 10) * 7_200_000,
  ).toISOString()
  await sql.begin(async (tx) => {
    await tx`
      update public.reservations
      set status = 'pending_payment', payment_expires_at = now() + interval '10 minutes'
      where id = ${slot.reservationId}
    `
    await tx`
      update public.lesson_schedules
      set starts_at = ${adjustedStartsAt}, ends_at = ${new Date(Date.parse(adjustedStartsAt) + 3600000).toISOString()}
      where id = ${slot.scheduleId}
    `
    await tx`
      update public.reservations
      set status = 'confirmed', payment_expires_at = null
      where id = ${slot.reservationId}
    `
  })
}

export async function readState(sql, slot) {
  const [state] = await sql`
    select
      (select status::text from public.reservations where id = ${slot.reservationId}) as reservation_status,
      (select payment.status::text from public.payments payment where reservation_id = ${slot.reservationId}) as payment_status,
      (select count(*)::int from public.audit_logs where target_id = ${slot.reservationId}
        and action in ('reservation.completed', 'reservation.no_show')) as lifecycle_audits,
      (select count(*)::int from public.notifications where data->>'reservationId' = ${slot.reservationId}
        and type in ('reservation.completed', 'reservation.no_show', 'review.requested')) as lifecycle_notifications,
      (select count(*)::int from public.refunds where reservation_id = ${slot.reservationId}
        and reason = 'reservation.coach_no_show') as coach_no_show_refunds,
      (select count(*)::int from public.settlements where reservation_id = ${slot.reservationId}) as settlements,
      (select reserved_count from public.lesson_schedules where id = ${slot.scheduleId}) as reserved_count
  `
  return state
}

export function userClient(clients, key) {
  const client = clients[key]
  if (!client) throw new Error(`Missing fixture client: ${key}`)
  return client
}

export function slot(
  suffix,
  reservationSuffix = `${Number(suffix) + 100}`,
  paymentSuffix = `${Number(suffix) + 200}`,
) {
  const prefix = "00000000-0000-4000-8000-00000000"
  return {
    suffix,
    scheduleId: `${prefix}0${suffix}`,
    reservationId: `${prefix}0${reservationSuffix}`,
    paymentId: `${prefix}0${paymentSuffix}`,
  }
}

export function personaEmail(key) {
  const user = fixtureUsers.find((candidate) => candidate.key === key)
  if (!user) throw new Error(`Missing fixture user: ${key}`)
  return user.email
}

function withApplicationName(dbUrl, applicationName) {
  const url = new URL(dbUrl)
  url.searchParams.set("application_name", applicationName)
  return url.toString()
}
