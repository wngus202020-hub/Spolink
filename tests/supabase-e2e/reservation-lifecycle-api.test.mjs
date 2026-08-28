import assert from "node:assert/strict"
import test from "node:test"

import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "./auth-rls/runtime.mjs"
import { fixedIds } from "./fixtures.mjs"
import {
  assertRejected,
  assertReplay,
  assertSucceeded,
  completeRequest,
  createRuntime,
  errors,
  finalizeRuntime,
  makeNoShowAvailable,
  missingReservationId,
  noShowRequest,
  restore,
  setCoach,
  validationEnvelope,
} from "./reservation-lifecycle/api-fixtures.mjs"
import { slot } from "./reservation-lifecycle/live-helpers.mjs"

const primary = slot("310", "410", "510")
const completion = slot("311", "411", "511")
const learnerNoShow = slot("312", "412", "512")
const coachNoShow = slot("313", "413", "513")
const unpaid = slot("314", "414", "514")
const stale = slot("315", "415", "515")
let provision
let runtime

test.before(async () => {
  const baseUrl = process.env.SPOLINK_TEST_BASE_URL
  assert.ok(baseUrl, "task8 must provide the configured Next base URL")
  assert.equal(["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname), true)
  await ensureAuthGatewayReady()
  provision = await provisionWithAuthReadiness()
  runtime = createRuntime(baseUrl, provision)
})

test.after(async () => finalizeRuntime(runtime, provision))

test("configured lifecycle HTTP preserves authorization, rollback, effects, and replay", async () => {
  await boundaryMatrix()
  await authorizationMatrix()
  await stateMatrix()
  await successMatrix()
})

async function boundaryMatrix() {
  for (const item of [
    ["complete", {}],
    ["no-show", { action: "mark_learner_no_show", reason: "late" }],
  ]) {
    const [route, body] = item
    const base = { body, reservationId: primary.reservationId, route }
    await rejectFresh(
      `${route} missing origin`,
      { ...base, includeOrigin: false },
      403,
      errors.origin,
    )
    await rejectFresh(
      `${route} cross origin`,
      { ...base, headers: { origin: "https://cross-origin.invalid" }, includeOrigin: false },
      403,
      errors.origin,
    )
    await rejectFresh(
      `${route} missing media`,
      { ...base, includeContentType: false },
      415,
      errors.media,
    )
    await rejectFresh(
      `${route} wrong media`,
      { ...base, contentType: "text/plain" },
      415,
      errors.media,
    )
    await rejectFresh(`${route} malformed json`, { ...base, rawBody: "{" }, 422, errors.malformed)
  }
  await rejectFresh(
    "complete authoritative extra",
    { body: { status: "completed" }, reservationId: primary.reservationId, route: "complete" },
    422,
    validationEnvelope("Invalid input"),
  )
  await rejectFresh(
    "no-show authoritative extra",
    {
      body: { action: "mark_learner_no_show", actorId: "forged", reason: "late" },
      reservationId: primary.reservationId,
      route: "no-show",
    },
    422,
    validationEnvelope("Invalid input"),
  )
}

async function authorizationMatrix() {
  for (const route of ["complete", "no-show"]) {
    const body = route === "complete" ? {} : { action: "mark_learner_no_show", reason: "late" }
    const base = { body, reservationId: primary.reservationId, route }
    await rejectFresh(`${route} anonymous`, base, 401, errors.unauthorized)
    await rejectFresh(`${route} learner`, { ...base, actor: "learner" }, 403, errors.forbidden)
    await restore(runtime, primary)
    await setCoach(runtime, "pendingCoach", "coach_approved", "approved")
    try {
      await reject(
        `${route} foreign coach`,
        { ...base, actor: "pendingCoach" },
        403,
        errors.forbidden,
      )
    } finally {
      await setCoach(runtime, "pendingCoach", "pending_coach", "submitted")
    }
    await restore(runtime, primary, { coach_profile_id: fixedIds.pendingCoachProfile })
    await reject(
      `${route} pending coach`,
      { ...base, actor: "pendingCoach" },
      403,
      errors.forbidden,
    )
    await restore(runtime, primary)
    await setCoach(runtime, "coach", "suspended", "approved")
    try {
      await reject(`${route} suspended coach`, { ...base, actor: "coach" }, 403, errors.forbidden)
    } finally {
      await setCoach(runtime, "coach", "coach_approved", "approved")
    }
  }
}

async function stateMatrix() {
  await rejectFresh(
    "early no-show",
    {
      actor: "coach",
      body: { action: "mark_learner_no_show", reason: "too early" },
      reservationId: primary.reservationId,
      route: "no-show",
    },
    422,
    errors.validation,
  )
  await restore(runtime, unpaid, {
    confirmed_at: new Date().toISOString(),
    payment_expires_at: null,
    status: "confirmed",
  })
  await reject("unpaid completion", completeRequest(unpaid, "coach"), 409, errors.conflict)
  await restore(runtime, stale, { status: "cancelled_by_user" })
  await reject(
    "cancelled no-show",
    noShowRequest(stale, "admin", "mark_coach_no_show", "cancelled"),
    409,
    errors.conflict,
  )
  await restore(runtime, stale, { completed_at: new Date().toISOString(), status: "completed" })
  await reject("stale completion", completeRequest(stale, "admin"), 409, errors.conflict)
  for (const route of ["complete", "no-show"]) {
    const body = route === "complete" ? {} : { action: "mark_learner_no_show", reason: "missing" }
    await rejectFresh(
      `${route} missing reservation`,
      {
        actor: "admin",
        body,
        reservationId: missingReservationId,
        route,
      },
      404,
      errors.missing,
    )
  }
}

async function successMatrix() {
  await restore(runtime, completion)
  const completed = await assertSucceeded(
    runtime,
    { ...completeRequest(completion, "coach"), name: "complete coach" },
    { status: "completed" },
  )
  await assertReplay(
    runtime,
    { ...completeRequest(completion, "admin"), name: "complete admin replay" },
    completed,
  )
  await reject(
    "opposite action conflict",
    noShowRequest(completion, "admin", "mark_learner_no_show", "opposite"),
    409,
    errors.conflict,
  )

  await restore(runtime, learnerNoShow)
  await makeNoShowAvailable(runtime, learnerNoShow)
  const learnerMarked = await assertSucceeded(
    runtime,
    {
      ...noShowRequest(learnerNoShow, "coach", "mark_learner_no_show", "learner late"),
      name: "learner no-show coach",
    },
    { status: "no_show_user" },
  )
  await assertReplay(
    runtime,
    {
      ...noShowRequest(learnerNoShow, "admin", "mark_learner_no_show", "  learner late  "),
      name: "learner no-show admin replay",
    },
    learnerMarked,
  )
  await reject(
    "changed normalized reason conflict",
    noShowRequest(learnerNoShow, "admin", "mark_learner_no_show", "changed"),
    409,
    errors.conflict,
  )

  await restore(runtime, coachNoShow)
  await makeNoShowAvailable(runtime, coachNoShow)
  const coachMarked = await assertSucceeded(
    runtime,
    {
      ...noShowRequest(coachNoShow, "admin", "mark_coach_no_show", "coach absent"),
      name: "coach no-show admin",
    },
    { status: "no_show_coach" },
  )
  await assertReplay(
    runtime,
    {
      ...noShowRequest(coachNoShow, "coach", "mark_coach_no_show", "coach absent"),
      name: "coach no-show coach replay",
    },
    coachMarked,
  )
}

async function rejectFresh(name, request, status, body) {
  await restore(runtime, primary)
  await reject(name, request, status, body)
}

async function reject(name, request, status, body) {
  await assertRejected(runtime, { ...request, name }, { body, status })
}
