import assert from "node:assert/strict"

import { fixedIds } from "./ids.mjs"
import { fixedPaymentIds, fixedReservationIds, fixedScheduleIds } from "./slots.mjs"

export async function assertFixtureGraph(sql, expectedRows, authIds) {
  assert.deepEqual(await readExactFixtureGraph(sql, authIds), expectedGraph(expectedRows, authIds))
}

export async function readExactFixtureGraph(sql, authIds) {
  const profileIds = Object.values(authIds)
  return {
    profiles: await readProfiles(sql, profileIds),
    coachProfiles: await readCoachProfiles(sql),
    lessons: await readLessons(sql),
    schedules: await readSchedules(sql),
    reservations: await readReservations(sql),
    payments: await readPayments(sql),
    refunds: await readRefunds(sql),
    sideEffects: await readGeneratedSideEffects(sql),
  }
}

export function expectedGraph(rows) {
  return {
    profiles: sortRows(
      rows.profiles.map((row) => ({
        id: row.id,
        role: row.role,
        status: row.status,
        display_name: row.display_name,
        real_name: null,
        phone: null,
        avatar_path: null,
        default_region: null,
        marketing_agreed_at: null,
        location_agreed_at: null,
        deleted_at: null,
      })),
    ),
    coachProfiles: sortRows(
      rows.coachProfiles.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        status: row.status,
        headline: null,
        bio: null,
        primary_sport_id: row.primary_sport_id,
        service_region: row.service_region,
        career_years: 0,
        intro_video_url: null,
        bank_name: null,
        bank_account_last4: null,
        payout_holder_name: null,
        submitted_at: null,
        reviewed_at: null,
        reviewed_by: null,
        rejection_reason: null,
      })),
    ),
    lessons: rows.lessons.map((row) => ({
      id: row.id,
      coach_profile_id: row.coach_profile_id,
      sport_id: row.sport_id,
      status: row.status,
      title: row.title,
      summary: null,
      description: row.description,
      region: row.region,
      address: null,
      place_name: null,
      latitude: null,
      longitude: null,
      duration_minutes: row.duration_minutes,
      price_amount: row.price_amount,
      capacity: row.capacity,
      preparation: null,
      cancellation_policy_summary: null,
      paused_reason: null,
    })),
    schedules: sortRows(rows.schedules.map(normalizeSchedule)),
    reservations: sortRows(rows.reservations.map(normalizeReservation)),
    payments: sortRows(rows.payments.map(normalizePayment)),
    refunds: sortRows(rows.refunds.map(normalizeRefund)),
    sideEffects: { notifications: 0, auditLogs: 0, cancellableCancellationRefunds: 0 },
  }
}

function normalizeSchedule(row) {
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    starts_at: toIso(row.starts_at),
    ends_at: toIso(row.ends_at),
    capacity: row.capacity,
    reserved_count: row.reserved_count,
    is_open: row.is_open,
  }
}

function normalizeReservation(row) {
  return {
    id: row.id,
    lesson_id: row.lesson_id,
    lesson_schedule_id: row.lesson_schedule_id,
    learner_id: row.learner_id,
    coach_profile_id: row.coach_profile_id,
    status: row.status,
    reserved_price_amount: row.reserved_price_amount,
    payment_expires_at: toIso(row.payment_expires_at),
    confirmed_at: toIso(row.confirmed_at),
    cancelled_at: toIso(row.cancelled_at),
    cancellation_reason: row.cancellation_reason,
    completed_at: null,
    no_show_marked_at: null,
    dispute_reason: null,
  }
}

function normalizePayment(row) {
  return {
    id: row.id,
    reservation_id: row.reservation_id,
    payer_id: row.payer_id,
    status: row.status,
    provider: row.provider,
    provider_order_id: row.provider_order_id,
    provider_payment_key: row.provider_payment_key,
    amount: row.amount,
    approved_at: toIso(row.approved_at),
    failed_reason: row.failed_reason,
    raw_payload: row.raw_payload,
  }
}

function normalizeRefund(row) {
  return {
    id: row.id,
    payment_id: row.payment_id,
    reservation_id: row.reservation_id,
    requested_by: row.requested_by,
    amount: row.amount,
    reason: row.reason,
    source: row.source,
    provider_refund_key: null,
    status: row.status,
    processed_at: null,
    raw_payload: null,
  }
}

async function readProfiles(sql, profileIds) {
  return sortRows(
    await sql`
    select id::text, role::text, status::text, display_name, real_name, phone, avatar_path,
      default_region, marketing_agreed_at, location_agreed_at, deleted_at
    from public.profiles
    where id in ${sql(profileIds)}
  `,
  )
}

async function readCoachProfiles(sql) {
  return sortRows(
    await sql`
    select id::text, user_id::text, status::text, headline, bio, primary_sport_id::text,
      service_region, career_years, intro_video_url, bank_name, bank_account_last4,
      payout_holder_name, submitted_at, reviewed_at, reviewed_by::text, rejection_reason
    from public.coach_profiles
    where id in (${fixedIds.approvedCoachProfile}, ${fixedIds.pendingCoachProfile})
  `,
  )
}

async function readLessons(sql) {
  return Array.from(
    await sql`
    select id::text, coach_profile_id::text, sport_id::text, status::text, title, summary,
      description, region, address, place_name, latitude, longitude, duration_minutes,
      price_amount, capacity, preparation, cancellation_policy_summary, paused_reason
    from public.lessons
    where id = ${fixedIds.lesson}
  `,
  )
}

async function readSchedules(sql) {
  return sortRows(
    (
      await sql`
    select id::text, lesson_id::text, starts_at, ends_at, capacity, reserved_count, is_open
    from public.lesson_schedules
    where id in ${sql(fixedScheduleIds())}
  `
    ).map(normalizeSchedule),
  )
}

async function readReservations(sql) {
  return sortRows(
    (
      await sql`
    select id::text, lesson_id::text, lesson_schedule_id::text, learner_id::text,
      coach_profile_id::text, status::text, reserved_price_amount, payment_expires_at,
      confirmed_at, cancelled_at, cancellation_reason, completed_at, no_show_marked_at,
      dispute_reason
    from public.reservations
    where id in ${sql(fixedReservationIds())}
  `
    ).map(normalizeReservation),
  )
}

async function readPayments(sql) {
  return sortRows(
    (
      await sql`
    select id::text, reservation_id::text, payer_id::text, status::text, provider,
      provider_order_id, provider_payment_key, amount, approved_at, failed_reason, raw_payload
    from public.payments
    where id in ${sql(fixedPaymentIds())}
  `
    ).map(normalizePayment),
  )
}

async function readRefunds(sql) {
  return sortRows(
    (
      await sql`
    select id::text, payment_id::text, reservation_id::text, requested_by::text, amount,
      reason, source, provider_refund_key, status::text, processed_at, raw_payload
    from public.refunds
    where id = ${fixedIds.historyRefund}
  `
    ).map(normalizeRefund),
  )
}

async function readGeneratedSideEffects(sql) {
  const [row] = await sql`
    select
      (select count(*)::int from public.notifications where data->>'reservationId' in ${sql(fixedReservationIds())}) as "notifications",
      (select count(*)::int from public.audit_logs where target_id in ${sql([...fixedReservationIds(), ...fixedPaymentIds()])}) as "auditLogs",
      (select count(*)::int from public.refunds where reservation_id = ${fixedIds.cancellableReservation} and source = 'reservation_cancellation') as "cancellableCancellationRefunds"
  `
  return row
}

function sortRows(rows) {
  return [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function toIso(value) {
  return value === null ? null : new Date(value).toISOString()
}
