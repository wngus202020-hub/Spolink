import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import postgres from "postgres"

import { fixedIds, fixedReservationIds, fixedScheduleIds, fixtureUsers } from "../fixtures.mjs"
import { listFixtureAuthUsers } from "../provision/auth-lifecycle.mjs"
import { cleanupFixtureGraph } from "../provision.mjs"
import { createLearnerCookieJar } from "../ssr-cookie-jar.mjs"
import { restoreSlot, setScheduleStarts } from "./live-helpers.mjs"

// allow: SIZE_OK — the task ownership boundary keeps the HTTP fixture DSL and exact DB projection together.

export const errors = Object.freeze({
  conflict: envelope("CONFLICT", "Reservation cannot be transitioned."),
  forbidden: envelope("FORBIDDEN", "Reservation lifecycle action is forbidden."),
  malformed: envelope("VALIDATION_ERROR", "Request body must be valid JSON."),
  media: envelope("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json."),
  missing: envelope("NOT_FOUND", "Reservation not found."),
  origin: envelope("FORBIDDEN", "Same-origin request required."),
  unauthorized: envelope("UNAUTHORIZED", "Authentication required."),
  validation: envelope("VALIDATION_ERROR", "Reservation lifecycle request is invalid."),
})
export const missingReservationId = `${fixedIds.cancellableReservation.slice(0, -3)}999`

export function validationEnvelope(...details) {
  return { error: { ...errors.validation.error, details } }
}

export function createRuntime(baseUrl, provision) {
  const requestBaseUrl = new URL(baseUrl)
  requestBaseUrl.hostname = "localhost"
  return {
    baseUrl,
    jars: new Map(),
    observations: [],
    provision,
    requestBaseUrl: requestBaseUrl.origin,
    sql: postgres(provision.status.dbUrl, { idle_timeout: 1, max: 1 }),
  }
}

export async function closeRuntime(runtime) {
  await runtime.sql.end({ timeout: 1 })
}

export async function finalizeRuntime(runtime, provision) {
  try {
    if (runtime)
      console.log(`TASK4_HTTP_SUMMARY ${JSON.stringify(summarize(runtime.observations))}`)
    if (runtime && provision) {
      await cleanupFixtureGraph(
        runtime.sql,
        provision.clients.serviceClient,
        await listFixtureAuthUsers(provision.clients.serviceClient),
      )
    }
  } finally {
    if (runtime) await closeRuntime(runtime)
    if (provision) await provision.cleanup()
  }
}

export async function assertRejected(runtime, request, expected) {
  const before = await readSnapshot(runtime)
  const response = await post(runtime, request)
  const bodyText = await response.text()
  const after = await readSnapshot(runtime)
  const beforeBytes = JSON.stringify(before)
  const afterBytes = JSON.stringify(after)
  let body
  try {
    body = JSON.parse(bodyText)
  } catch {
    body = null
  }
  runtime.observations.push({
    bodySha256: hash(bodyText),
    code: body?.error?.code ?? "INVALID_RESPONSE",
    name: request.name,
    noStore: response.headers.get("cache-control") === "private, no-store",
    rollbackAfterSha256: hash(afterBytes),
    rollbackBeforeSha256: hash(beforeBytes),
    rollbackEquivalent: afterBytes === beforeBytes,
    status: response.status,
    type: "rejected",
  })
  assert.equal(afterBytes, beforeBytes, `${request.name} mutated the fixture graph`)
  assertNoStore(response)
  assertError(response, body, expected)
}

export async function assertSucceeded(runtime, request, expected) {
  const before = await readTargetState(runtime.sql, request.reservationId)
  const response = await post(runtime, request)
  const body = await response.json()
  assert.equal(response.status, 200)
  assertNoStore(response)
  assert.deepEqual(Object.keys(body), ["data"])
  assert.deepEqual(Object.keys(body.data).sort(), [
    "completedAt",
    "noShowMarkedAt",
    "refund",
    "reservationId",
    "settlementId",
    "status",
  ])
  assert.equal(body.data.reservationId, request.reservationId)
  assert.equal(body.data.status, expected.status)
  assert.equal(body.data.completedAt === null, expected.status !== "completed")
  assert.equal(body.data.noShowMarkedAt === null, expected.status === "completed")
  assert.equal(body.data.refund === null, expected.status !== "no_show_coach")
  assert.equal(body.data.settlementId === null, expected.status !== "completed")
  if (body.data.refund) {
    assert.deepEqual(Object.keys(body.data.refund).sort(), ["amount", "id", "status"])
    assert.equal(body.data.refund.amount, 10001)
    assert.equal(body.data.refund.status, "requested")
  }
  const state = await readTargetState(runtime.sql, request.reservationId)
  assert.deepEqual(state, expectedState(runtime, request, body, before, expected.status))
  runtime.observations.push(successObservation(request.name, response, body, state, "success"))
  return { bodyBytes: JSON.stringify(body), stateBytes: JSON.stringify(state) }
}

export async function assertReplay(runtime, request, first) {
  const response = await post(runtime, request)
  const body = await response.json()
  assert.equal(response.status, 200)
  assertNoStore(response)
  const bodyBytes = JSON.stringify(body)
  const stateBytes = JSON.stringify(await readTargetState(runtime.sql, request.reservationId))
  assert.equal(bodyBytes, first.bodyBytes)
  assert.equal(stateBytes, first.stateBytes)
  runtime.observations.push(
    successObservation(request.name, response, body, JSON.parse(stateBytes), "replay"),
  )
}

export async function restore(runtime, slot, overrides = {}) {
  await restoreSlot(runtime.sql, runtime.provision, slot)
  const original = runtime.provision.rows.reservations.find((row) => row.id === slot.reservationId)
  assert.ok(original)
  await runtime.sql`
    update public.reservations set coach_profile_id = ${original.coach_profile_id}
    where id = ${slot.reservationId}
  `
  if (Object.keys(overrides).length > 0) {
    await runtime.sql`update public.reservations set ${runtime.sql(overrides)} where id = ${slot.reservationId}`
  }
}

export async function makeNoShowAvailable(runtime, slot) {
  await setScheduleStarts(runtime.sql, slot, new Date(Date.now() - 16 * 60 * 1000).toISOString())
}

export async function setCoach(runtime, actor, profileStatus, coachStatus) {
  const actorId = runtime.provision.authIds[actor]
  const coach = runtime.provision.rows.coachProfiles.find((row) => row.user_id === actorId)
  assert.ok(coach)
  await runtime.sql.begin(async (sql) => {
    await sql`update public.profiles set status = ${profileStatus} where id = ${actorId}`
    await sql`update public.coach_profiles set status = ${coachStatus} where id = ${coach.id}`
  })
  return coach.id
}

export function completeRequest(target, actor) {
  return { actor, body: {}, reservationId: target.reservationId, route: "complete" }
}

export function noShowRequest(target, actor, action, reason) {
  return { actor, body: { action, reason }, reservationId: target.reservationId, route: "no-show" }
}

export function summarize(observations) {
  return {
    cases: observations,
    rejected: observations.filter((entry) => entry.type === "rejected").length,
    replayed: observations.filter((entry) => entry.type === "replay").length,
    rollbackFailures: observations.filter(
      (entry) => entry.type === "rejected" && !entry.rollbackEquivalent,
    ).length,
    succeeded: observations.filter((entry) => entry.type === "success").length,
  }
}

async function post(runtime, request) {
  const headers = { ...(request.headers ?? {}) }
  if (request.includeOrigin !== false) {
    const baseUrl = new URL(runtime.requestBaseUrl)
    headers.host = baseUrl.host
    headers.origin = baseUrl.origin
    headers["x-forwarded-host"] = baseUrl.host
    headers["x-forwarded-proto"] = baseUrl.protocol.slice(0, -1)
  }
  if (request.includeContentType !== false)
    headers["content-type"] = request.contentType ?? "application/json"
  if (request.actor) headers.cookie = (await cookie(runtime, request.actor)).cookieHeader()
  return fetch(
    `${runtime.requestBaseUrl}/api/reservations/${request.reservationId}/${request.route}`,
    {
      body: request.rawBody ?? JSON.stringify(request.body),
      headers,
      method: "POST",
    },
  )
}

async function cookie(runtime, actor) {
  if (runtime.jars.has(actor)) return runtime.jars.get(actor)
  const user = fixtureUsers.find((candidate) => candidate.key === actor)
  assert.ok(user)
  const jar = await createLearnerCookieJar({
    email: user.email,
    password: runtime.provision.runPassword,
    status: runtime.provision.status,
  })
  runtime.jars.set(actor, jar)
  return jar
}

function assertError(response, body, expected) {
  assert.equal(response.status, expected.status, JSON.stringify(body))
  assert.notEqual(body, null)
  assert.deepEqual(Object.keys(body), ["error"])
  assert.deepEqual(Object.keys(body.error).sort(), ["code", "details", "message"])
  assert.deepEqual(body, expected.body)
}

function assertNoStore(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store")
}

async function readSnapshot(runtime) {
  const { sql } = runtime
  const reservationIds = fixedReservationIds()
  const scheduleIds = fixedScheduleIds()
  const profileIds = Object.values(runtime.provision.authIds)
  const coachProfileIds = runtime.provision.rows.coachProfiles.map((row) => row.id)
  const [snapshot] = await sql`
    select
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.reservations where id in ${sql(reservationIds)}) row) reservations,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.payments where reservation_id in ${sql(reservationIds)}) row) payments,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.lesson_schedules where id in ${sql(scheduleIds)}) row) schedules,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.refunds where reservation_id in ${sql(reservationIds)}) row) refunds,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.settlements where reservation_id in ${sql(reservationIds)}) row) settlements,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.audit_logs where target_id in ${sql(reservationIds)}) row) audits,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.notifications where data->>'reservationId' in ${sql(reservationIds)}) row) notifications,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.profiles where id in ${sql(profileIds)}) row) profiles,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select * from public.coach_profiles where id in ${sql(coachProfileIds)}) row) coach_profiles
  `
  return snapshot
}

async function readTargetState(sql, reservationId) {
  const [state] = await sql`
    select
      (select to_jsonb(row) from (select id, lesson_id, lesson_schedule_id, learner_id,
        coach_profile_id, status::text, reserved_price_amount, payment_expires_at, confirmed_at,
        cancelled_at, cancellation_reason, completed_at, no_show_marked_at, dispute_reason
        from public.reservations where id = ${reservationId}) row) reservation,
      (select to_jsonb(row) from (select id, reservation_id, payer_id, status::text, provider,
        provider_payment_key, provider_order_id, amount, approved_at, failed_reason, raw_payload
        from public.payments where reservation_id = ${reservationId}) row) payment,
      (select jsonb_build_object('id', schedule.id, 'reserved_count', schedule.reserved_count)
        from public.lesson_schedules schedule join public.reservations reservation
          on reservation.lesson_schedule_id = schedule.id where reservation.id = ${reservationId}) schedule,
      (select coalesce(jsonb_agg(jsonb_build_object('actor_id', actor_id, 'action', action,
        'target_type', target_type, 'target_id', target_id, 'before_data', before_data,
        'after_data', after_data) order by action), '[]') from public.audit_logs
        where target_id = ${reservationId} and action in ('reservation.completed', 'reservation.no_show')) audits,
      (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'type', type,
        'data', data) order by type), '[]') from public.notifications
        where data->>'reservationId' = ${reservationId}) notifications,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select id, payment_id,
        reservation_id, requested_by, amount, reason, source, provider_refund_key, status::text,
        processed_at, raw_payload from public.refunds where reservation_id = ${reservationId}) row) refunds,
      (select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]') from (select id,
        reservation_id, coach_profile_id, payment_id, status::text, gross_amount,
        platform_fee_amount, payment_fee_amount, refund_amount, net_amount, hold_reason,
        approved_at, paid_at from public.settlements where reservation_id = ${reservationId}) row) settlements
  `
  return state
}

function expectedState(runtime, request, body, before, status) {
  const reason = request.body.reason?.trim() ?? null
  const actorId = runtime.provision.authIds[request.actor]
  const reservation = {
    ...before.reservation,
    completed_at: body.data.completedAt,
    no_show_marked_at: body.data.noShowMarkedAt,
    status,
  }
  const audits = [
    {
      action: status === "completed" ? "reservation.completed" : "reservation.no_show",
      actor_id: actorId,
      after_data: { reason, status },
      before_data: { status: "confirmed" },
      target_id: request.reservationId,
      target_type: "reservation",
    },
  ]
  const notification = (type, data) => ({ data, type, user_id: reservation.learner_id })
  const notifications =
    status === "completed"
      ? [
          notification("reservation.completed", { reservationId: request.reservationId }),
          notification("review.requested", {
            lessonId: reservation.lesson_id,
            reservationId: request.reservationId,
          }),
        ]
      : [notification("reservation.no_show", { reservationId: request.reservationId, status })]
  const refunds =
    body.data.refund === null
      ? []
      : [
          {
            amount: reservation.reserved_price_amount,
            id: body.data.refund.id,
            payment_id: before.payment.id,
            processed_at: null,
            provider_refund_key: null,
            raw_payload: null,
            reason: "reservation.coach_no_show",
            requested_by: actorId,
            reservation_id: request.reservationId,
            source: "manual",
            status: "requested",
          },
        ]
  const settlements =
    body.data.settlementId === null
      ? []
      : [
          {
            approved_at: null,
            coach_profile_id: reservation.coach_profile_id,
            gross_amount: reservation.reserved_price_amount,
            hold_reason: null,
            id: body.data.settlementId,
            net_amount: reservation.reserved_price_amount,
            paid_at: null,
            payment_fee_amount: 0,
            payment_id: before.payment.id,
            refund_amount: 0,
            reservation_id: request.reservationId,
            status: "pending",
            platform_fee_amount: 0,
          },
        ]
  return { ...before, audits, notifications, refunds, reservation, settlements }
}

function successObservation(name, response, body, state, type) {
  return {
    bodySha256: hash(JSON.stringify(body)),
    exactProjection: true,
    name,
    noStore: true,
    projectionSha256: hash(JSON.stringify(state)),
    status: response.status,
    type,
  }
}

function envelope(code, message) {
  return { error: { code, details: [], message } }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}
