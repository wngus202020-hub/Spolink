import assert from "node:assert/strict"

import {
  assertCancelledPolicyState,
  assertPristinePolicyState,
} from "./cancellation-policy-assertions.mjs"
import {
  assertProfileRestored,
  missingReservationId,
  mutateProfileStatus,
  readPolicyState,
  restorePolicySlot,
} from "./cancellation-policy-helper.mjs"
import { fixedIds, fixtureUsers } from "./fixtures.mjs"
import { createLearnerCookieJar, sha256 } from "./ssr-cookie-jar.mjs"

export function createPolicyRuntime(state) {
  return {
    runDenied: (policyCase) => runDenied(state, policyCase),
    runIdempotentRepeat: (slot) => runIdempotentRepeat(state, slot),
    runSuccess: (policyCase) => runSuccess(state, policyCase),
  }
}

async function runSuccess(state, policyCase) {
  await restorePolicySlot(state.observer, state.provision, policyCase.slot)
  const response = await post(
    state,
    policyCase.slot.reservationId,
    { reason: policyCase.reason },
    await jar(state, policyCase.actor),
  )
  const body = await response.json()
  assertSuccess(response, body, policyCase.slot, policyCase.status, policyCase.refund)
  const snapshot = await readPolicyState(state.observer, policyCase.slot)
  assertCancelledPolicyState(snapshot, expected(state, policyCase.actor, policyCase))
  assert.equal(snapshot.notifications.length, (policyCase.recipients ?? ["coach"]).length)
  record(state, policyCase.name, response, body, snapshot)
}

async function runDenied(state, policyCase) {
  const options = resolveDeniedOptions(policyCase.options ?? {})
  const reservation = { ...(options.reservation ?? {}) }
  if (options.coachProfileId) reservation.coach_profile_id = options.coachProfileId
  await restorePolicySlot(state.observer, state.provision, policyCase.slot, { reservation })
  if (options.profile) await mutateLearnerProfile(state, options.profile)
  try {
    const before = await readPolicyState(state.observer, policyCase.slot)
    const response = await post(
      state,
      options.missing ? missingReservationId : policyCase.slot.reservationId,
      options.raw ?? { reason: `Todo6 ${policyCase.name}` },
      policyCase.actor ? await jar(state, policyCase.actor) : null,
      Boolean(options.raw),
    )
    const body = await response.json()
    assertError(response, body, policyCase.status, policyCase.code)
    const after = await readPolicyState(state.observer, policyCase.slot)
    assert.deepEqual(after, before)
    assertPristinePolicyState(after, policyCase.slot, state.provision, { reservation })
    record(state, policyCase.name, response, body, before)
  } finally {
    if (options.profile) {
      await mutateLearnerProfile(state, ["active", null])
      await assertProfileRestored(state.observer, state.provision.authIds.learner)
    }
  }
}

async function runIdempotentRepeat(state, slot) {
  await restorePolicySlot(state.observer, state.provision, slot)
  const cookie = await jar(state, "learner")
  const first = await post(state, slot.reservationId, { reason: "Todo6 same reason" }, cookie)
  const firstBody = await first.json()
  assertSuccess(first, firstBody, slot, "cancelled_by_user", 7000)
  const firstState = await readPolicyState(state.observer, slot)
  assertCancelledPolicyState(
    firstState,
    expected(state, "learner", {
      reason: "Todo6 same reason",
      refund: 7000,
      status: "cancelled_by_user",
    }),
  )
  const repeat = await post(state, slot.reservationId, { reason: "Todo6 same reason" }, cookie)
  const repeatBody = await repeat.json()
  assert.equal(repeat.status, 200)
  assert.deepEqual(repeatBody, firstBody)
  assert.deepEqual(await readPolicyState(state.observer, slot), firstState)
  const conflict = await post(
    state,
    slot.reservationId,
    { reason: "Todo6 different reason" },
    cookie,
  )
  const conflictBody = await conflict.json()
  assertError(conflict, conflictBody, 409, "CONFLICT")
  assert.deepEqual(await readPolicyState(state.observer, slot), firstState)
  record(state, "slot 315 idempotent repeat", repeat, repeatBody, firstState)
  record(state, "slot 315 conflicting repeat", conflict, conflictBody, firstState)
}

async function mutateLearnerProfile(state, [status, deletedAt]) {
  await mutateProfileStatus(
    state.observer,
    state.provision.authIds.admin,
    state.provision.authIds.learner,
    status,
    deletedAt,
  )
}

async function jar(state, key) {
  const user = fixtureUsers.find((candidate) => candidate.key === key)
  if (!user) throw new Error(`Missing fixture user: ${key}`)
  return createLearnerCookieJar({
    email: user.email,
    password: state.provision.runPassword,
    status: state.provision.status,
  })
}

async function post(state, id, body, cookie = null, raw = false) {
  const headers = {
    "content-type": "application/json",
    origin: new URL(state.server.baseUrl).origin,
  }
  if (cookie) headers.cookie = cookie.cookieHeader()
  return fetch(`${state.server.baseUrl}/api/reservations/${id}/cancel`, {
    body: raw ? body : JSON.stringify(body),
    headers,
    method: "POST",
  })
}

function assertSuccess(response, body, slot, status, refund) {
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(body), ["data"])
  assert.equal(body.data.reservationId, slot.reservationId)
  assert.equal(body.data.status, status)
  assert.equal(Number.isNaN(Date.parse(body.data.cancelledAt)), false)
  if (refund === null) assert.equal(body.data.refund, null)
  else {
    assert.equal(body.data.refund.amount, refund)
    assert.equal(body.data.refund.status, "requested")
    assert.match(body.data.refund.id, /^[0-9a-f-]{36}$/)
  }
}

function assertError(response, body, status, code) {
  assert.equal(response.status, status)
  assert.deepEqual(Object.keys(body), ["error"])
  assert.equal(body.error.code, code)
  assert.deepEqual(body.error.details, [])
}

function expected(state, actor, policyCase) {
  const before = policyCase.before ?? ["confirmed", "paid"]
  const refund = policyCase.refund
  const status = policyCase.status
  const ids = state.provision.authIds
  return {
    audits: [expectedAudit(ids, actor, status, refund, before)],
    notifications: (policyCase.recipients ?? ["coach"])
      .map((key) => ({ status, type: "reservation_cancelled", user_id: ids[key] }))
      .sort((left, right) => left.user_id.localeCompare(right.user_id)),
    paymentStatus: before[1] === "ready" ? "cancelled" : "paid",
    reason: policyCase.reason,
    refunds: expectedRefunds(ids, actor, refund),
    reservedCount: 0,
    status,
  }
}

function expectedAudit(ids, actor, status, refund, before) {
  return {
    actor_id: ids[actor],
    actor_type: actor,
    after_status: status,
    before_payment_status: before[1],
    before_status: before[0],
    refund_amount: refund,
  }
}

function expectedRefunds(ids, actor, refund) {
  if (refund === null) return []
  return [
    {
      amount: refund,
      requested_by: ids[actor],
      source: "reservation_cancellation",
      status: "requested",
    },
  ]
}

function record(state, name, response, body, snapshot) {
  state.observations.push({
    bodySha256: sha256(JSON.stringify(body)),
    dbStateSha256: sha256(JSON.stringify(snapshot)),
    name,
    status: response.status,
  })
}

function resolveDeniedOptions(options) {
  if (options.coachProfileId === "pendingCoachProfile") {
    return { ...options, coachProfileId: fixedIds.pendingCoachProfile }
  }
  return options
}
