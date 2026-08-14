import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import postgres from "postgres"

import { fixedIds, fixtureUsers } from "../fixtures.mjs"
import { readGuardedLocalStatus } from "../local-status.mjs"

const observerContract = [
  "reservation 0402 all Todo2 fields",
  "schedule 0301 all Todo2 fields",
  "payment 0502 all Todo2 fields",
  "all refunds for reservation 0402 including source/provider fields",
  "all notifications for reservation 0402 including user_id/type/status",
  "all audits targeting reservation 0402 including actor/action/before/after",
].join("\n")

export async function withQaSql(callback) {
  const status = await readGuardedLocalStatus()
  const sql = postgres(status.dbUrl, { idle_timeout: 1, max: 1 })
  try {
    return await callback(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }
}

export async function assertQaState(mode, responseBody = null, reason = null) {
  return withQaSql(async (sql) => {
    const authIds = await readFixtureAuthIds(sql)
    const state = await readQaState(sql)
    assertQaSnapshot(state, authIds, mode, responseBody, reason)
    const snapshot = redactedSnapshot(state, authIds)
    return {
      querySha256: sha256(observerContract),
      resultSha256: sha256(JSON.stringify(snapshot)),
      snapshot,
    }
  })
}

export function assertQaSnapshot(state, authIds, mode, responseBody = null, reason = null) {
  assertCommon(state, authIds)
  if (mode === "pristine") assertPristine(state)
  else if (mode === "cancelled") assertCancelled(state, authIds, responseBody, reason)
  else throw new Error(`Unknown QA state mode: ${mode}`)
}

export async function removeQaSideEffects(sql) {
  await sql`delete from public.refunds where reservation_id = ${fixedIds.cancellableReservation} and source = 'reservation_cancellation'`
  await sql`delete from public.notifications where data->>'reservationId' = ${fixedIds.cancellableReservation}`
  await sql`delete from public.audit_logs where target_id = ${fixedIds.cancellableReservation} and action = 'reservation.cancelled'`
}

export async function readFixtureAuthIds(sql) {
  const emails = fixtureUsers.map((user) => user.email)
  const rows = await sql`select id::text, email from auth.users where email in ${sql(emails)}`
  const byEmail = new Map(rows.map((row) => [row.email, row.id]))
  return Object.fromEntries(fixtureUsers.map((user) => [user.key, byEmail.get(user.email)]))
}

export async function readQaState(sql) {
  const [state] = await sql`
    select
      (select row_to_json(r) from (select id::text, lesson_id::text, lesson_schedule_id::text,
        learner_id::text, coach_profile_id::text, status::text, reserved_price_amount,
        payment_expires_at, confirmed_at, cancelled_at, cancellation_reason, completed_at,
        no_show_marked_at, dispute_reason from public.reservations
        where id = ${fixedIds.cancellableReservation}) r) as reservation,
      (select row_to_json(s) from (select id::text, lesson_id::text, starts_at, ends_at,
        capacity, reserved_count, is_open from public.lesson_schedules
        where id = ${fixedIds.baselineOpenSchedule}) s) as schedule,
      (select row_to_json(p) from (select id::text, reservation_id::text, payer_id::text,
        status::text, provider, provider_order_id, provider_payment_key, amount, approved_at,
        failed_reason, raw_payload from public.payments
        where id = ${fixedIds.cancellablePayment}) p) as payment,
      (select coalesce(json_agg(row_to_json(f) order by f.id), '[]'::json) from
        (select id::text, payment_id::text, reservation_id::text, requested_by::text, amount,
          reason, source, provider_refund_key, status::text, processed_at, raw_payload
         from public.refunds where reservation_id = ${fixedIds.cancellableReservation}) f) as refunds,
      (select coalesce(json_agg(row_to_json(n) order by n.id), '[]'::json) from
        (select id::text, user_id::text, type, data->>'status' as status
         from public.notifications
         where data->>'reservationId' = ${fixedIds.cancellableReservation}) n) as notifications,
      (select coalesce(json_agg(row_to_json(a) order by a.id), '[]'::json) from
        (select id::text, actor_id::text, action, target_type, target_id::text,
          before_data, after_data from public.audit_logs
         where target_id = ${fixedIds.cancellableReservation}) a) as audits
  `
  return state
}

function assertCommon(state, authIds) {
  assert.equal(state.reservation.id, fixedIds.cancellableReservation)
  assert.equal(state.reservation.lesson_id, fixedIds.lesson)
  assert.equal(state.reservation.lesson_schedule_id, fixedIds.baselineOpenSchedule)
  assert.equal(state.reservation.learner_id, authIds.learner)
  assert.equal(state.reservation.coach_profile_id, fixedIds.approvedCoachProfile)
  assert.equal(state.reservation.reserved_price_amount, 10001)
  assert.equal(state.reservation.payment_expires_at, null)
  assert.notEqual(state.reservation.confirmed_at, null)
  assert.equal(state.reservation.completed_at, null)
  assert.equal(state.reservation.no_show_marked_at, null)
  assert.equal(state.reservation.dispute_reason, null)
  assert.equal(state.schedule.id, fixedIds.baselineOpenSchedule)
  assert.equal(state.schedule.lesson_id, fixedIds.lesson)
  assert.equal(state.schedule.capacity, 2)
  assert.equal(state.schedule.is_open, true)
  assert.equal(new Date(state.schedule.starts_at).getTime() >= Date.now() + 86_400_000, true)
  assert.equal(
    new Date(state.schedule.ends_at).getTime() - new Date(state.schedule.starts_at).getTime(),
    3_600_000,
  )
  assertPayment(state, authIds)
}

function assertPayment(state, authIds) {
  assert.equal(state.payment.id, fixedIds.cancellablePayment)
  assert.equal(state.payment.reservation_id, fixedIds.cancellableReservation)
  assert.equal(state.payment.payer_id, authIds.learner)
  assert.equal(state.payment.status, "paid")
  assert.equal(state.payment.provider, "toss")
  assert.equal(state.payment.provider_order_id, `spolink_${fixedIds.cancellableReservation}`)
  assert.equal(state.payment.provider_payment_key, "local-seed-402")
  assert.equal(state.payment.amount, 10001)
  assert.notEqual(state.payment.approved_at, null)
  assert.equal(
    new Date(state.payment.approved_at).getTime(),
    new Date(state.reservation.confirmed_at).getTime(),
  )
  assert.equal(state.payment.failed_reason, null)
  assert.deepEqual(state.payment.raw_payload, {
    orderId: `spolink_${fixedIds.cancellableReservation}`,
    paymentKey: "local-seed-402",
    status: "DONE",
    totalAmount: 10001,
  })
}

function assertPristine(state) {
  assert.equal(state.reservation.status, "confirmed")
  assert.equal(state.reservation.cancelled_at, null)
  assert.equal(state.reservation.cancellation_reason, null)
  assert.equal(state.schedule.reserved_count, 1)
  assert.deepEqual(state.refunds, [])
  assert.deepEqual(state.notifications, [])
  assert.deepEqual(state.audits, [])
}

function assertCancelled(state, authIds, responseBody, reason) {
  assert.equal(state.reservation.status, "cancelled_by_user")
  assert.equal(state.reservation.cancelled_at, responseBody.data.cancelledAt)
  assert.equal(state.reservation.cancellation_reason, reason)
  assert.equal(state.schedule.reserved_count, 0)
  assert.equal(state.refunds.length, 1)
  assert.equal(state.refunds[0].id, responseBody.data.refund.id)
  assert.equal(state.refunds[0].payment_id, fixedIds.cancellablePayment)
  assert.equal(state.refunds[0].reservation_id, fixedIds.cancellableReservation)
  assert.equal(state.refunds[0].requested_by, authIds.learner)
  assert.equal(state.refunds[0].amount, 7000)
  assert.equal(state.refunds[0].reason, reason)
  assert.equal(state.refunds[0].source, "reservation_cancellation")
  assert.equal(state.refunds[0].provider_refund_key, null)
  assert.equal(state.refunds[0].status, "requested")
  assert.equal(state.refunds[0].processed_at, null)
  assert.equal(state.refunds[0].raw_payload, null)
  assert.equal(responseBody.data.refund.amount, state.refunds[0].amount)
  assert.equal(responseBody.data.refund.status, state.refunds[0].status)
  assert.equal(state.notifications.length, 1)
  assert.equal(state.notifications[0].user_id, authIds.coach)
  assert.equal(state.notifications[0].type, "reservation_cancelled")
  assert.equal(state.notifications[0].status, "cancelled_by_user")
  assert.equal(state.audits.length, 1)
  assert.equal(state.audits[0].actor_id, authIds.learner)
  assert.equal(state.audits[0].action, "reservation.cancelled")
  assert.equal(state.audits[0].target_type, "reservation")
  assert.equal(state.audits[0].target_id, fixedIds.cancellableReservation)
  assert.deepEqual(state.audits[0].before_data, { paymentStatus: "paid", status: "confirmed" })
  assert.deepEqual(state.audits[0].after_data, {
    actorType: "learner",
    reason,
    refundAmount: 7000,
    refundId: responseBody.data.refund.id,
    status: "cancelled_by_user",
  })
}

function redactedSnapshot(state, authIds) {
  const snapshot = structuredClone(state)
  snapshot.reservation.learner_id = persona(snapshot.reservation.learner_id, authIds)
  snapshot.payment.payer_id = persona(snapshot.payment.payer_id, authIds)
  snapshot.payment.provider_order_id_sha256 = sha256(snapshot.payment.provider_order_id)
  snapshot.payment.provider_order_id = "<redacted>"
  snapshot.payment.provider_payment_key_sha256 = sha256(snapshot.payment.provider_payment_key)
  snapshot.payment.provider_payment_key_present = snapshot.payment.provider_payment_key !== null
  snapshot.payment.provider_payment_key = "<redacted>"
  snapshot.payment.raw_payload.orderIdSha256 = sha256(snapshot.payment.raw_payload.orderId)
  snapshot.payment.raw_payload.orderId = "<redacted>"
  snapshot.payment.raw_payload.paymentKeySha256 = sha256(snapshot.payment.raw_payload.paymentKey)
  snapshot.payment.raw_payload.paymentKey = "<redacted>"
  for (const refund of snapshot.refunds) refund.requested_by = persona(refund.requested_by, authIds)
  for (const notification of snapshot.notifications) {
    notification.user_id = persona(notification.user_id, authIds)
    delete notification.id
  }
  for (const audit of snapshot.audits) {
    audit.actor_id = persona(audit.actor_id, authIds)
    delete audit.id
  }
  return snapshot
}

function persona(id, authIds) {
  const match = Object.entries(authIds).find(([, value]) => value === id)
  return match?.[0] ?? "unknown"
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
