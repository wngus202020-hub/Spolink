import assert from "node:assert/strict"
import postgres from "postgres"

import { findRow } from "./cancellation-policy-assertions.mjs"
import { expandFixedId, fixedIds, policySlots } from "./fixtures.mjs"

export const missingReservationId = `${fixedIds.cancellableReservation.slice(0, -3)}999`

export function createPolicyObserver(status) {
  return postgres(status.dbUrl, { max: 1, idle_timeout: 1 })
}

export function slotByReservationSuffix(suffix) {
  const slot = policySlots.find((candidate) => candidate.reservation === suffix)
  if (!slot) throw new Error(`Missing cancellation policy slot: ${suffix}`)
  return {
    ...slot,
    paymentId: expandFixedId(slot.payment),
    reservationId: expandFixedId(slot.reservation),
    scheduleId: expandFixedId(slot.suffix),
  }
}

export async function restorePolicySlot(sql, provision, slot, overrides = {}) {
  const schedule = findRow(provision.rows.schedules, slot.scheduleId)
  const reservation = {
    ...findRow(provision.rows.reservations, slot.reservationId),
    ...overrides.reservation,
  }
  const payment = { ...findRow(provision.rows.payments, slot.paymentId), ...overrides.payment }

  await sql.begin(async (tx) => {
    await removeGeneratedSideEffects(tx, slot)
    await tx`
      update public.lesson_schedules set
        starts_at = ${schedule.starts_at},
        ends_at = ${schedule.ends_at},
        capacity = ${schedule.capacity},
        reserved_count = ${overrides.reservedCount ?? schedule.reserved_count},
        is_open = ${schedule.is_open}
      where id = ${slot.scheduleId}
    `
    await tx`
      update public.reservations set
        learner_id = ${reservation.learner_id},
        coach_profile_id = ${reservation.coach_profile_id},
        lesson_schedule_id = ${reservation.lesson_schedule_id},
        status = ${reservation.status},
        reserved_price_amount = ${reservation.reserved_price_amount},
        payment_expires_at = ${reservation.payment_expires_at},
        confirmed_at = ${reservation.confirmed_at},
        completed_at = null,
        cancelled_at = ${reservation.cancelled_at},
        cancellation_reason = ${reservation.cancellation_reason},
        no_show_marked_at = null,
        dispute_reason = null
      where id = ${slot.reservationId}
    `
    await tx`
      update public.payments set
        payer_id = ${payment.payer_id},
        reservation_id = ${payment.reservation_id},
        status = ${payment.status},
        provider = ${payment.provider},
        provider_order_id = ${payment.provider_order_id},
        provider_payment_key = ${payment.provider_payment_key},
        amount = ${payment.amount},
        approved_at = ${payment.approved_at},
        failed_reason = ${payment.failed_reason},
        raw_payload = ${payment.raw_payload}
      where id = ${slot.paymentId}
    `
  })
}

export async function readPolicyState(sql, slot) {
  const [state] = await sql`
    select
      (select row_to_json(row) from (
        select id::text, learner_id::text, coach_profile_id::text, lesson_schedule_id::text,
          status::text, reserved_price_amount, payment_expires_at is not null as has_payment_expiry,
          confirmed_at is not null as has_confirmed_at, completed_at is not null as has_completed_at,
          cancelled_at is not null as has_cancelled_at, cancellation_reason
        from public.reservations where id = ${slot.reservationId}
      ) row) as reservation,
      (select row_to_json(row) from (
        select id::text, reservation_id::text, payer_id::text, status::text, provider,
          provider_order_id, provider_payment_key is not null as has_provider_key,
          amount, approved_at is not null as has_approved_at, failed_reason,
          raw_payload is not null as has_raw_payload
        from public.payments where id = ${slot.paymentId}
      ) row) as payment,
      (select row_to_json(row) from (
        select id::text, reserved_count, capacity, is_open
        from public.lesson_schedules where id = ${slot.scheduleId}
      ) row) as schedule,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.id::text), '[]'::jsonb) from (
        select id, requested_by::text, amount, reason, source::text, status::text,
          processed_at is not null as processed
        from public.refunds
        where reservation_id = ${slot.reservationId}
      ) row) as refunds,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.user_id::text), '[]'::jsonb) from (
        select user_id::text, type, data->>'status' as status
        from public.notifications
        where data->>'reservationId' = ${slot.reservationId}
      ) row) as notifications,
      (select coalesce(jsonb_agg(row_to_json(row) order by row.actor_id::text), '[]'::jsonb) from (
        select actor_id::text, action, target_type,
          before_data->>'status' as before_status,
          before_data->>'paymentStatus' as before_payment_status,
          after_data->>'status' as after_status,
          after_data->>'reason' as reason,
          after_data->>'actorType' as actor_type,
          nullif(after_data->>'refundAmount', '')::int as refund_amount,
          after_data ? 'refundId' as has_refund_id_key
        from public.audit_logs
        where target_id = ${slot.reservationId}
          and action = 'reservation.cancelled'
      ) row) as audits
  `
  return state
}

export async function mutateProfileStatus(sql, adminId, profileId, status, deletedAt) {
  await sql.begin(async (tx) => {
    await setAuthenticatedActor(tx, adminId)
    await tx`
      update public.profiles
      set status = ${status}, deleted_at = ${deletedAt}
      where id = ${profileId}
    `
  })
}

export async function assertProfileRestored(sql, profileId) {
  const [profile] = await sql`
    select status::text, deleted_at is not null as deleted
    from public.profiles
    where id = ${profileId}
  `
  assert.deepEqual(profile, { deleted: false, status: "active" })
}

async function removeGeneratedSideEffects(sql, slot) {
  await sql`
    delete from public.audit_logs
    where target_id = ${slot.reservationId}
       or target_id = ${slot.paymentId}
       or after_data->>'refundId' in (
         select id::text from public.refunds where reservation_id = ${slot.reservationId}
       )
  `
  await sql`delete from public.notifications where data->>'reservationId' = ${slot.reservationId}`
  await sql`delete from public.refunds where reservation_id = ${slot.reservationId}`
}

async function setAuthenticatedActor(sql, actorId) {
  await sql`
    select set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', ${actorId}::uuid, 'role', 'authenticated')::text,
      true
    )
  `
  await sql`select set_config('request.jwt.claim.sub', ${actorId}, true)`
  await sql`select set_config('request.jwt.claim.role', 'authenticated', true)`
}
