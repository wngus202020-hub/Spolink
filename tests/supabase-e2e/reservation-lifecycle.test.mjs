import assert from "node:assert/strict"
import test from "node:test"

import { writeFocusedReservationLifecycleReceipt } from "../high-priority-missing-services/task3-evidence.mjs"
import { ensureAuthGatewayReady } from "./auth-rls/runtime.mjs"
import { listFixtureAuthUsers } from "./provision/auth-lifecycle.mjs"
import { cleanupFixtureGraph, provisionFixtures } from "./provision.mjs"
import { writeTask5DbRaceReceipt } from "./reservation-lifecycle/evidence.mjs"
import {
  callCancellation,
  callLifecycle,
  createLifecycleRuntime,
  crossNoShowStatementBoundary,
  restoreSlot,
  setScheduleStarts,
  slot,
  userClient,
} from "./reservation-lifecycle/live-helpers.mjs"
import { runLifecycleRaceMatrix } from "./reservation-lifecycle/race-matrix.mjs"
import {
  assertLifecycleState,
  coachNoShowState,
  completedState,
  learnerNoShowState,
  readLifecycleState,
} from "./reservation-lifecycle/race-state.mjs"

let provision
let runtime
const observations = []
const boundaries = []
let raceReports = []

test.before(async () => {
  await ensureAuthGatewayReady()
  provision = await provisionFixtures()
  runtime = await createLifecycleRuntime(provision.status, provision.runPassword)
})

test.after(async () => {
  const cleanup = []
  let cleanupError = null
  try {
    if (runtime) {
      await runtime.barrier.close()
      await runtime.sql.end({ timeout: 1 })
      cleanup.push("observer-and-barrier-closed")
    }
    if (provision) {
      const postgres = (await import("postgres")).default
      const cleanupSql = postgres(provision.status.dbUrl, { idle_timeout: 1, max: 1 })
      try {
        await cleanupFixtureGraph(
          cleanupSql,
          provision.clients.serviceClient,
          await listFixtureAuthUsers(provision.clients.serviceClient),
        )
      } finally {
        await cleanupSql.end({ timeout: 1 })
      }
      await provision.cleanup()
      cleanup.push("fixture-graph-removed")
    }
  } catch (error) {
    observations.push({ status: "cleanup-failed", message: String(error) })
    cleanupError = error
  }
  await writeFocusedReservationLifecycleReceipt({
    attemptRoot: process.env.SPOLINK_TASK3_ATTEMPT_DIR,
    cleanup,
    observations,
    repoRoot: process.cwd(),
  })
  await writeTask5DbRaceReceipt({
    attemptRoot: process.env.SPOLINK_TASK3_ATTEMPT_DIR,
    boundaries,
    cleanup,
    observations,
    races: raceReports,
    repoRoot: process.cwd(),
  })
  if (cleanupError) throw cleanupError
})

test("no-show uses statement time when one transaction crosses the 15-minute boundary", async (t) => {
  const target = slot("310", "410", "510")
  const reason = "statement-time boundary"
  try {
    const observation = await crossNoShowStatementBoundary({
      adminId: provision.authIds.admin,
      reason,
      sql: runtime.sql,
      target,
    })

    assert.ok(observation.transaction_time < observation.available_at)
    assert.ok(observation.available_at <= observation.statement_time)
    assert.equal(observation.no_show_marked_at.getTime(), observation.statement_time.getTime())
    assert.equal(observation.reservation_status, "no_show_user")
    t.diagnostic("transaction_time < available_at <= statement_time; persisted = statement_time")

    const replay = await callLifecycle(
      userClient(runtime.clients, "admin"),
      target.reservationId,
      "mark_learner_no_show",
      reason,
    )
    assert.equal(replay.errorCode, null)
    assertLifecycleState(
      await readLifecycleState(runtime.sql, target),
      learnerNoShowState(reason, "admin"),
    )
  } finally {
    await restoreSlot(runtime.sql, provision, target)
  }
})

test("real lifecycle RPC enforces authorization, state, payment, and exact replay semantics", async () => {
  const reservation = slot("310", "410", "510")
  await assertRejectedWithoutMutation({
    action: () => callLifecycle(runtime.clients.anonymous, reservation.reservationId, "complete"),
    expectedCode: "42501",
    name: "anonymous",
    slot: reservation,
  })
  await assertRejectedWithoutMutation({
    action: () =>
      callLifecycle(
        userClient(runtime.clients, "otherLearner"),
        reservation.reservationId,
        "complete",
      ),
    expectedCode: "42501",
    name: "foreign",
    slot: reservation,
  })
  await setScheduleStarts(
    runtime.sql,
    reservation,
    new Date(Date.now() - (15 * 60 * 1000 - 5_000)).toISOString(),
  )
  await assertRejectedWithoutMutation({
    action: () =>
      callLifecycle(
        userClient(runtime.clients, "coach"),
        reservation.reservationId,
        "mark_learner_no_show",
        "early",
      ),
    expectedCode: "22023",
    name: "early-no-show",
    slot: reservation,
  })
  for (const actor of ["learner", "coach", "admin"]) {
    const before = await readLifecycleState(runtime.sql, reservation)
    const { data, error } = await userClient(runtime.clients, actor)
      .from("reservations")
      .update({ status: "completed" })
      .eq("id", reservation.reservationId)
      .select("status")
    assert.equal(data, null)
    assert.equal(error?.code, "42501")
    assert.deepEqual(await readLifecycleState(runtime.sql, reservation), before)
    boundaries.push({ errorCode: error.code, mutated: false, name: `direct-table-${actor}` })
  }

  const unpaid = slot("314", "414", "514")
  await assertRejectedWithoutMutation({
    action: () =>
      callLifecycle(userClient(runtime.clients, "coach"), unpaid.reservationId, "complete"),
    expectedCode: "P0001",
    name: "unpaid",
    slot: unpaid,
  })

  const completed = slot("311", "411", "511")
  const completion = await callLifecycle(
    userClient(runtime.clients, "coach"),
    completed.reservationId,
    "complete",
  )
  assert.equal(completion.errorCode, null)
  const completionReplay = await callLifecycle(
    userClient(runtime.clients, "admin"),
    completed.reservationId,
    "complete",
  )
  assert.equal(completionReplay.errorCode, null)
  assertLifecycleState(await readLifecycleState(runtime.sql, completed), completedState())

  const noShow = slot("312", "412", "512")
  await setScheduleStarts(runtime.sql, noShow, new Date(Date.now() - 16 * 60 * 1000).toISOString())
  const noShowResult = await callLifecycle(
    userClient(runtime.clients, "coach"),
    noShow.reservationId,
    "mark_learner_no_show",
    "  learner late  ",
  )
  assert.equal(noShowResult.errorCode, null)
  const noShowReplay = await callLifecycle(
    userClient(runtime.clients, "admin"),
    noShow.reservationId,
    "mark_learner_no_show",
    "learner late",
  )
  assert.equal(noShowReplay.errorCode, null)
  const conflictingReplay = await callLifecycle(
    userClient(runtime.clients, "admin"),
    noShow.reservationId,
    "mark_learner_no_show",
    "different reason",
  )
  assert.equal(conflictingReplay.errorCode, "23505")
  assertLifecycleState(
    await readLifecycleState(runtime.sql, noShow),
    learnerNoShowState("learner late"),
  )

  const coachNoShow = slot("313", "413", "513")
  await setScheduleStarts(
    runtime.sql,
    coachNoShow,
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
  )
  const coachNoShowResult = await callLifecycle(
    userClient(runtime.clients, "admin"),
    coachNoShow.reservationId,
    "mark_coach_no_show",
    "coach absent",
  )
  assert.equal(coachNoShowResult.errorCode, null)
  assertLifecycleState(
    await readLifecycleState(runtime.sql, coachNoShow),
    coachNoShowState("coach absent"),
  )

  const cancelled = slot("315", "415", "515")
  const cancellation = await callCancellation(
    userClient(runtime.clients, "learner"),
    cancelled.reservationId,
    "cancel before lifecycle",
  )
  assert.equal(cancellation.errorCode, null)
  await assertRejectedWithoutMutation({
    action: () =>
      callLifecycle(userClient(runtime.clients, "coach"), cancelled.reservationId, "complete"),
    expectedCode: "P0001",
    name: "cancelled",
    slot: cancelled,
  })
  observations.push({ name: "authorization-state-replay-effects", status: "passed" })
})

test("real lifecycle RPC races serialize completion/no-show/cancellation/payment to one winner", async () => {
  raceReports = await runLifecycleRaceMatrix(runtime, provision)
  observations.push({ name: "completion-no-show-cancellation-payment-races", status: "passed" })
})

async function assertRejectedWithoutMutation({ action, expectedCode, name, slot: targetSlot }) {
  const before = await readLifecycleState(runtime.sql, targetSlot)
  const result = await action()
  assert.equal(result.errorCode, expectedCode)
  assert.deepEqual(await readLifecycleState(runtime.sql, targetSlot), before)
  boundaries.push({ errorCode: expectedCode, mutated: false, name })
}
