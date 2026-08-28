import assert from "node:assert/strict"

import { restoreSlot, setScheduleStarts } from "./live-helpers.mjs"
import { lifecycleRaceScenarios } from "./race-scenarios.mjs"
import { assertLifecycleState, countPendingLockWorkers, readLifecycleState } from "./race-state.mjs"

export async function runLifecycleRaceMatrix(runtime, provision) {
  const reports = []
  for (const scenario of lifecycleRaceScenarios(runtime)) {
    await restoreSlot(runtime.sql, provision, scenario.slot)
    if (scenario.noShowAvailable) {
      await setScheduleStarts(
        runtime.sql,
        scenario.slot,
        new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      )
    }
    const result = await runBlockedRace(runtime, scenario)
    assert.deepEqual(
      [result.first.value.errorCode, result.second.value.errorCode],
      scenario.statusPair,
      scenario.name,
    )
    assert.deepEqual(result.settlementOrder, ["first", "second"], scenario.name)
    assertBarrier(result, scenario.functions)
    const state = await readLifecycleState(runtime.sql, scenario.slot)
    assertLifecycleState(state, scenario.expectedState)
    const pendingWorkers = await countPendingLockWorkers(runtime.sql, result.workerPids)
    assert.equal(pendingWorkers, 0, `${scenario.name} left a pending lock worker`)
    reports.push(reportRace(scenario, result, state, pendingWorkers))
  }
  return reports
}

async function runBlockedRace(runtime, scenario) {
  const baselinePids = await runtime.barrier.captureBaseline()
  const holder = await runtime.barrier.holdReservation(scenario.slot.reservationId)
  const settlementOrder = []
  try {
    const firstStartedAtWallMs = Date.now()
    const first = observe("first", scenario.first(), settlementOrder)
    const firstWait = await runtime.barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [worker("first", first.promise, scenario.firstFunction, firstStartedAtWallMs)],
    })
    const secondStartedAtWallMs = Date.now()
    const second = observe("second", scenario.second(), settlementOrder)
    const waits = await runtime.barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [
        worker(
          "first",
          first.promise,
          scenario.firstFunction,
          firstStartedAtWallMs,
          firstWait[0].pid,
        ),
        worker(
          "second",
          second.promise,
          scenario.secondFunction,
          secondStartedAtWallMs,
          undefined,
          [firstWait[0].pid],
        ),
      ],
    })
    holder.release()
    await holder.done
    const values = await Promise.all([first.observed, second.observed])
    return {
      first: values[0],
      second: values[1],
      settlementOrder,
      waits: { first: firstWait, second: waits },
      workerPids: waits.map((wait) => wait.pid),
    }
  } catch (error) {
    holder.abort()
    await holder.done
    throw error
  }
}

function observe(label, promise, settlementOrder) {
  const observed = promise.then((value) => {
    settlementOrder.push(label)
    return { label, value }
  })
  return { observed, promise }
}

function worker(label, promise, functionName, startedAtWallMs, pid, excludePids = []) {
  return {
    excludePids,
    functionNames: [functionName],
    label,
    pid,
    promise,
    startedAtHrtimeNs: process.hrtime.bigint().toString(),
    startedAtWallMs,
  }
}

function assertBarrier(result, functions) {
  const firstInitial = result.waits.first[0]
  const firstQueued = result.waits.second.find((wait) => wait.workerLabel === "first")
  const secondQueued = result.waits.second.find((wait) => wait.workerLabel === "second")
  assert.ok(firstQueued && secondQueued)
  assert.deepEqual(firstInitial.blockerChain.length, 2)
  assert.deepEqual(firstQueued.blockerChain.length, 2)
  assert.deepEqual(secondQueued.blockerChain.length, 3)
  assert.equal(firstInitial.matchedFunction, functions.first)
  assert.equal(firstQueued.matchedFunction, functions.first)
  assert.equal(secondQueued.matchedFunction, functions.second)
}

function reportRace(scenario, result, state, pendingWorkers) {
  const replay = scenario.statusPair[1] === null && scenario.statusPair[0] === null
  return {
    barrierChainLengths: { first: 2, second: 3 },
    effects: {
      auditActions: state.audits.map((row) => row.action),
      audits: state.audits.length,
      notifications: state.notifications.length,
      notificationTypes: state.notifications.map((row) => row.type),
      refunds: state.refunds.length,
      settlements: state.settlements.length,
    },
    final: {
      payment: state.payment.status,
      reservation: state.reservation.status,
      reservedCount: state.reserved_count,
    },
    loser: replay ? "replay" : scenario.winner === "first" ? "second" : "first",
    name: scenario.name,
    pendingWorkers,
    settlementOrder: result.settlementOrder,
    statusPair: scenario.statusPair,
    winner: scenario.winner,
  }
}
