import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import postgres from "postgres"

import { acquireMoneyOperationsRuntime } from "./money-operations-local-runtime.mjs"

const paymentId = randomUUID()
const reservationId = randomUUID()
const learnerId = randomUUID()
const coachId = randomUUID()
const coachProfileId = randomUUID()
const lessonId = randomUUID()
const scheduleId = randomUUID()
const refundIds = [randomUUID(), randomUUID(), randomUUID()]

test("money operations serialize concurrent refund, claim, and settlement contenders", async () => {
  const runtime = await acquireMoneyOperationsRuntime()
  const sql = postgres(runtime.status.dbUrl, { max: 4, prepare: false })
  try {
    const sport = await sql`select id from public.sports where slug = 'tennis' limit 1`
    assert.ok(sport[0]?.id)
    await sql`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000000', ${learnerId}, 'authenticated', 'authenticated', ${`money-concurrency-learner-${learnerId}@spolink.test`}, '', now(), ${sql.json({ provider: "email", providers: ["email"] })}, '{}'), ('00000000-0000-0000-0000-000000000000', ${coachId}, 'authenticated', 'authenticated', ${`money-concurrency-coach-${coachId}@spolink.test`}, '', now(), ${sql.json({ provider: "email", providers: ["email"] })}, '{}') on conflict (id) do nothing`
    await sql`insert into public.profiles (id, role, status, display_name) values (${learnerId}, 'learner', 'active', 'Money learner'), (${coachId}, 'coach', 'coach_approved', 'Money coach') on conflict (id) do update set role = excluded.role, status = excluded.status`
    await sql`insert into public.coach_profiles (id, user_id, status, primary_sport_id, service_region) values (${coachProfileId}, ${coachId}, 'approved', ${sport[0].id}, '서울') on conflict (id) do update set status = excluded.status, primary_sport_id = excluded.primary_sport_id`
    await sql`insert into public.lessons (id, coach_profile_id, sport_id, status, title, description, region, duration_minutes, price_amount, capacity) values (${lessonId}, ${coachProfileId}, ${sport[0].id}, 'active', 'Money concurrency lesson', 'Money concurrency fixture', '서울', 60, 10001, 2) on conflict (id) do nothing`
    await sql`insert into public.lesson_schedules (id, lesson_id, starts_at, ends_at, capacity, reserved_count, is_open) values (${scheduleId}, ${lessonId}, now() + interval '2 days', now() + interval '2 days 1 hour', 2, 1, false) on conflict (id) do nothing`
    await sql`insert into public.reservations (id, lesson_id, lesson_schedule_id, learner_id, coach_profile_id, status, reserved_price_amount, confirmed_at, completed_at) values (${reservationId}, ${lessonId}, ${scheduleId}, ${learnerId}, ${coachProfileId}, 'completed', 10001, now() - interval '2 days', now() - interval '24 hours') on conflict (id) do update set status = excluded.status, completed_at = excluded.completed_at`
    await sql`insert into public.payments (id, reservation_id, payer_id, status, provider, provider_order_id, amount, approved_at) values (${paymentId}, ${reservationId}, ${learnerId}, 'paid', 'local', ${`money-concurrency-${paymentId}`}, 10001, now() - interval '2 days') on conflict (id) do update set status = excluded.status, amount = excluded.amount`
    await sql`delete from public.refunds where id in ${sql(refundIds)}`
    await sql`delete from public.settlements where reservation_id = ${reservationId}`
    await sql`update public.reservations set status = 'completed', completed_at = now() - interval '24 hours' where id = ${reservationId}`

    const paymentResults = await Promise.allSettled([
      insertRefund(sql, refundIds[0]),
      insertRefund(sql, refundIds[1]),
    ])
    assert.equal(paymentResults.filter((result) => result.status === "fulfilled").length, 1)
    assert.equal(paymentResults.filter((result) => result.status === "rejected").length, 1)
    const refundTotal =
      await sql`select coalesce(sum(amount), 0)::integer as total from public.refunds where payment_id = ${paymentId} and status in ('requested', 'approved', 'completed')`
    assert.equal(refundTotal[0].total, 6000)

    await sql`insert into public.refunds (id, payment_id, reservation_id, requested_by, amount, reason, source) values (${refundIds[2]}, ${paymentId}, ${reservationId}, ${learnerId}, 1000, 'concurrent claim', 'manual')`
    const claimResults = await Promise.all([
      claimRefund(sql, "money-concurrency-a"),
      claimRefund(sql, "money-concurrency-b"),
    ])
    assert.equal(claimResults.filter((result) => result.error === null).length, 1)
    assert.equal(claimResults.filter((result) => result.error !== null).length, 1)
    const winner = claimResults.find((result) => result.error === null)
    assert.ok(winner?.data?.[0]?.claim_token)
    await sql`select * from public.process_refund_result(${refundIds[2]}, 'fail', null, 'TIMEOUT', ${sql.json({ source: "local" })}, ${winner.data[0].claim_token})`
    const terminal =
      await sql`select status, last_failure_code, processed_at, claim_token from public.refunds where id = ${refundIds[2]}`
    assert.deepEqual(
      terminal.map((row) => [row.status, row.last_failure_code, row.claim_token === null]),
      [["failed", "TIMEOUT", true]],
    )

    await sql`delete from public.refunds where id in ${sql(refundIds)}`
    const settlementResults = await Promise.all([generateSettlement(sql), generateSettlement(sql)])
    assert.equal(settlementResults[0][0].settlement_id, settlementResults[1][0].settlement_id)
    assert.equal(
      (
        await sql`select count(*)::integer as count from public.settlements where reservation_id = ${reservationId}`
      )[0].count,
      1,
    )
  } finally {
    try {
      await sql`delete from public.refunds where id in ${sql(refundIds)}`
      await sql`delete from public.settlements where reservation_id = ${reservationId}`
      await sql`update public.reservations set status = 'confirmed', completed_at = null where id = ${reservationId}`
      await sql`delete from public.payments where id = ${paymentId}`
      await sql`delete from public.reservations where id = ${reservationId}`
      await sql`delete from public.lesson_schedules where id = ${scheduleId}`
      await sql`delete from public.lessons where id = ${lessonId}`
      await sql`delete from public.coach_profiles where id = ${coachProfileId}`
      await sql`delete from public.profiles where id in (${learnerId}, ${coachId})`
      await sql`delete from auth.users where id in (${learnerId}, ${coachId})`
    } finally {
      try {
        await sql.end({ timeout: 5 })
      } finally {
        await runtime.release()
      }
    }
  }
})

async function insertRefund(sql, id) {
  return sql.begin(async (transaction) => {
    await transaction`insert into public.refunds (id, payment_id, reservation_id, requested_by, amount, reason, source) values (${id}, ${paymentId}, ${reservationId}, ${learnerId}, 6000, 'concurrent total', 'manual')`
  })
}

async function claimRefund(sql, key) {
  try {
    const data = await sql`select * from public.claim_refund(${refundIds[2]}, ${key})`
    return { data, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

async function generateSettlement(sql) {
  return sql`select * from public.generate_settlement(${reservationId})`
}
