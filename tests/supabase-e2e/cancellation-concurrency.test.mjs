import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "./auth-rls/runtime.mjs"
import { finalizeTodo7Evidence } from "./cancellation-concurrency/evidence.mjs"
import {
  assertCancelledState,
  assertConfirmedThenCancelledState,
  assertReconciledCancellationState,
} from "./cancellation-concurrency/expected-states.mjs"
import { createRaceRunner } from "./cancellation-concurrency/race-runner.mjs"
import {
  assertRaceResultOrder,
  providerEvidence,
  raceSlot,
} from "./cancellation-concurrency/slots.mjs"
import {
  assertCounts,
  createRaceObserver,
  readRaceState,
  restoreRaceSlot,
} from "./cancellation-concurrency/state.mjs"
import { createPaymentWorkers } from "./cancellation-concurrency/workers.mjs"
import { createDatabaseBarrier } from "./database-barrier.mjs"
import { assertNoRootEnvFiles, capturePort3002, startNextServer } from "./next-server.mjs"
import { assertSupabaseSsrContracts } from "./ssr-cookie-jar.mjs"

const forceTimeout = process.env.SPOLINK_E2E_FORCE_LOCK_TIMEOUT === "1"
const slots = Object.fromEntries(
  ["420", "421", "422", "423", "424"].map((suffix) => [suffix, raceSlot(suffix)]),
)
let provision
let observer
let server
let before3002
let barrier
let paymentWorkers
let raceRunner
const observations = []

test.before(async () => {
  await assertNoRootEnvFiles()
  await assertSupabaseSsrContracts()
  before3002 = await capturePort3002()
  await ensureAuthGatewayReady()
  provision = await provisionWithAuthReadiness()
  observer = createRaceObserver(provision.status)
  barrier = createDatabaseBarrier(provision.status.dbUrl, "spolink-todo7-barrier")
  paymentWorkers = createPaymentWorkers(provision.status)
  raceRunner = createRaceRunner({
    barrier,
    getProvision: () => provision,
    getServer: () => server,
    paymentWorkers,
  })
  server = await startNextServer({ mode: "configured", status: provision.status })
})

test.after(async () => {
  await finalizeTodo7Evidence({
    barrier,
    before3002,
    observations,
    observer,
    provision,
    server,
  })
})

test("baseline characterization: sequential cancellation and confirmation observables are stable", async () => {
  await restoreRaceSlot(observer, provision, slots["420"])
  const cancellation = await runCancel(slots["420"], "Todo7 baseline cancellation")
  assert.equal(cancellation.status, 200)
  assert.equal(cancellation.body.data.refund.amount, 7000)
  const cancelled = await readRaceState(observer, slots["420"])
  assert.equal(cancelled.reservation.status, "cancelled_by_user")
  assertCounts(cancelled, { cancelAudits: 1, cancelNotifications: 1, cancellationRefunds: 1 })

  await restoreRaceSlot(observer, provision, slots["423"])
  const confirmed = await runConfirm(slots["423"])
  assert.equal(confirmed.status, "ok")
  const state = await readRaceState(observer, slots["423"])
  assert.equal(state.reservation.status, "confirmed")
  assert.equal(state.payment.status, "paid")
  assertCounts(state, { confirmAudits: 1, confirmNotifications: 1 })
  record("baseline", { cancellation, confirmed, state })
})

if (forceTimeout) {
  test("forced lock timeout aborts workers and rolls back the barrier", async () => {
    await restoreRaceSlot(observer, provision, slots["420"])
    await raceRunner.runRace({
      forceTimeout,
      slot: slots["420"],
      workerA: () => raceRunner.cancelWorker(slots["420"], "Todo7 forced timeout A"),
      workerB: () => raceRunner.cancelWorker(slots["420"], "Todo7 forced timeout A"),
      workerBFunctions: "cancel_reservation",
    })
  })
} else {
  test("slot 320 duplicate equivalent cancellation serializes to one side-effect set", async () => {
    await restoreRaceSlot(observer, provision, slots["420"])
    const result = await raceRunner.runRace({
      slot: slots["420"],
      workerA: () => raceRunner.cancelWorker(slots["420"], "Todo7 duplicate"),
      workerB: () => raceRunner.cancelWorker(slots["420"], "Todo7 duplicate"),
      workerBFunctions: "cancel_reservation",
    })
    assertRaceResultOrder(result, { A: "cancel_reservation", B: "cancel_reservation" })
    assert.equal(result.A.status, 200)
    assert.equal(result.B.status, 200)
    assert.deepEqual(result.B.body, result.A.body)
    const state = await readRaceState(observer, slots["420"])
    assert.equal(state.refunds[0].amount, 7000)
    assertCounts(state, { cancelAudits: 1, cancelNotifications: 1, cancellationRefunds: 1 })
    assertCancelledState(state, expectedState(slots["420"], "Todo7 duplicate"))
    record("slot320", { result, state })
  })

  test("slot 321 conflicting duplicate cancellation yields one success and one 409", async () => {
    await restoreRaceSlot(observer, provision, slots["421"])
    const result = await raceRunner.runRace({
      slot: slots["421"],
      workerA: () => raceRunner.cancelWorker(slots["421"], "Todo7 first reason"),
      workerB: () => raceRunner.cancelWorker(slots["421"], "Todo7 second reason"),
      workerBFunctions: "cancel_reservation",
    })
    assertRaceResultOrder(result, { A: "cancel_reservation", B: "cancel_reservation" })
    assert.equal(result.A.status, 200)
    assert.equal(result.B.status, 409)
    assert.equal(result.B.body.error.code, "CONFLICT")
    const state = await readRaceState(observer, slots["421"])
    assertCounts(state, { cancelAudits: 1, cancelNotifications: 1, cancellationRefunds: 1 })
    assertCancelledState(state, expectedState(slots["421"], "Todo7 first reason"))
    record("slot321", { result, state })
  })

  test("slot 322 cancellation before confirmation reconciles provider success once", async () => {
    await restoreRaceSlot(observer, provision, slots["422"])
    const result = await raceRunner.runRace({
      slot: slots["422"],
      workerA: () => raceRunner.cancelWorker(slots["422"], "Todo7 cancel before confirm"),
      workerB: () => paymentWorkers.confirm(slots["422"]),
      workerBFunctions: "confirm_paid_reservation",
    })
    assertRaceResultOrder(result, { A: "cancel_reservation", B: "confirm_paid_reservation" })
    assert.equal(result.A.status, 200)
    assert.equal(result.B.errorCode, "23505")
    const reconciliationWait = await raceRunner.runSingleWait(
      slots["422"],
      () => paymentWorkers.reconcile(slots["422"]),
      "mark_payment_confirmation_reconciliation_required",
    )
    assert.equal(reconciliationWait.worker.status, "ok")
    const state = await readRaceState(observer, slots["422"])
    assert.deepEqual(state.payment.raw_payload, providerEvidence(slots["422"]))
    assertCounts(state, {
      cancelAudits: 1,
      cancelNotifications: 1,
      cancellationRefunds: 0,
      confirmAudits: 0,
      confirmNotifications: 0,
      reconciliationAudits: 1,
      reconciliationRefunds: 1,
    })
    assert.equal(state.refunds[0].amount, 10001)
    assertReconciledCancellationState(
      state,
      expectedState(slots["422"], "Todo7 cancel before confirm"),
    )
    record("slot322", { reconciliationWait, result, state })
  })

  test("slot 323 confirmation before cancellation confirms then refunds normally", async () => {
    await restoreRaceSlot(observer, provision, slots["423"])
    const result = await raceRunner.runRace({
      slot: slots["423"],
      workerA: () => paymentWorkers.confirm(slots["423"]),
      workerAFunctions: "confirm_paid_reservation",
      workerB: () => raceRunner.cancelWorker(slots["423"], "Todo7 confirm before cancel"),
      workerBFunctions: "cancel_reservation",
    })
    assertRaceResultOrder(result, { A: "confirm_paid_reservation", B: "cancel_reservation" })
    assert.equal(result.A.status, "ok")
    assert.equal(result.B.status, 200)
    const state = await readRaceState(observer, slots["423"])
    assert.equal(state.reserved_count, 0)
    assertCounts(state, {
      cancelAudits: 1,
      cancelNotifications: 1,
      cancellationRefunds: 1,
      confirmAudits: 1,
      confirmNotifications: 1,
      reconciliationAudits: 0,
      reconciliationRefunds: 0,
    })
    assert.equal(state.refunds[0].amount, 7000)
    assertConfirmedThenCancelledState(
      state,
      expectedState(slots["423"], "Todo7 confirm before cancel"),
    )
    record("slot323", { result, state })
  })

  test("slot 324 reconciliation idempotency adds no state on identical repeats", async () => {
    await restoreRaceSlot(observer, provision, slots["424"])
    const result = await raceRunner.runRace({
      slot: slots["424"],
      workerA: () => raceRunner.cancelWorker(slots["424"], "Todo7 reconciliation race"),
      workerB: () => paymentWorkers.reconcile(slots["424"]),
      workerBFunctions: "mark_payment_confirmation_reconciliation_required",
    })
    assertRaceResultOrder(result, {
      A: "cancel_reservation",
      B: "mark_payment_confirmation_reconciliation_required",
    })
    assert.equal(result.A.status, 200)
    assert.equal(result.B.status, "ok")
    const beforeRepeat = await readRaceState(observer, slots["424"])
    await raceRunner.runReconcile(slots["424"])
    await raceRunner.runReconcile(slots["424"])
    const afterRepeat = await readRaceState(observer, slots["424"])
    assert.deepEqual(afterRepeat, beforeRepeat)
    assertCounts(afterRepeat, {
      cancelAudits: 1,
      cancelNotifications: 1,
      confirmAudits: 0,
      confirmNotifications: 0,
      reconciliationAudits: 1,
      reconciliationRefunds: 1,
    })
    assert.equal(afterRepeat.refunds[0].amount, 10001)
    assertReconciledCancellationState(
      afterRepeat,
      expectedState(slots["424"], "Todo7 reconciliation race"),
    )
    record("slot324", { result, state: afterRepeat })
  })
}

async function runCancel(slot, reason) {
  return raceRunner.runCancel(slot, reason)
}

async function runConfirm(slot) {
  return raceRunner.runConfirm(slot)
}

function record(name, value) {
  observations.push({ name, sha256: sha256(JSON.stringify(value)), value })
}

function expectedState(slot, reason) {
  return { authIds: provision.authIds, reason, slot }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
