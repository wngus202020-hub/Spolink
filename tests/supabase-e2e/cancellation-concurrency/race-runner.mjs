import assert from "node:assert/strict"

import { fixtureUsers } from "../fixtures.mjs"
import { createLearnerCookieJar } from "../ssr-cookie-jar.mjs"
import { createCancellationWorker } from "./workers.mjs"

export function createRaceRunner({ barrier, getProvision, getServer, paymentWorkers }) {
  return {
    cancelWorker: (slot, reason) => cancelWorker({ getProvision, getServer, reason, slot }),
    runCancel: async (slot, reason) =>
      (await cancelWorker({ getProvision, getServer, reason, slot })).promise,
    runConfirm: async (slot) => paymentWorkers.confirm(slot).promise,
    runRace: (options) => runRace({ barrier, ...options }),
    runReconcile: async (slot) => {
      const result = await paymentWorkers.reconcile(slot).promise
      assert.equal(result.status, "ok")
      return result
    },
    runSingleWait: (slot, workerFactory, functionName) =>
      runSingleWait({ barrier, functionName, slot, workerFactory }),
  }
}

async function runRace({
  barrier,
  forceTimeout = false,
  slot,
  workerA,
  workerAFunctions = "cancel_reservation",
  workerB,
  workerBFunctions,
}) {
  const baselinePids = await barrier.captureBaseline()
  const holder = await barrier.holdReservation(slot.reservationId)
  const raceStartedAtNs = process.hrtime.bigint()
  const settledAtHrtimeNs = {}
  const settledOrder = []
  let A = null
  let B = null
  let observedA = null
  let observedB = null
  try {
    A = await workerA()
    observedA = observeSettlement("A", A.promise, settledOrder, settledAtHrtimeNs)
    const waitA = await barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [workerIdentity("A", A, workerAFunctions)],
    })
    B = await workerB()
    observedB = observeSettlement("B", B.promise, settledOrder, settledAtHrtimeNs)
    const waitB = await barrier.waitForBlocked({
      baselinePids,
      lockerPid: holder.lockerPid,
      workers: [
        workerIdentity("A", A, workerAFunctions, waitA[0].pid),
        workerIdentity("B", B, workerBFunctions),
      ],
    })
    if (forceTimeout) {
      A.abort()
      B.abort()
      holder.abort()
      await holder.done
      await Promise.all([observedA, observedB])
      const durationMs = Number(process.hrtime.bigint() - raceStartedAtNs) / 1_000_000
      throw new Error(
        `Forced Todo7 lock timeout: ${JSON.stringify({
          abortRequested: ["A", "B"],
          barrierRolledBack: true,
          durationMs,
          settledOrder,
          waiters: waitB,
        })}`,
      )
    }
    holder.release()
    await holder.done
    const [resultA, resultB] = await Promise.all([observedA, observedB])
    return {
      A: completeResult("A", resultA, settledAtHrtimeNs),
      B: completeResult("B", resultB, settledAtHrtimeNs),
      settledOrder,
      waits: { A: waitA, B: waitB },
    }
  } catch (error) {
    if (A) A.abort()
    if (B) B.abort()
    holder.abort()
    await holder.done
    throw error
  }
}

async function runSingleWait({ barrier, functionName, slot, workerFactory }) {
  const baselinePids = await barrier.captureBaseline()
  const holder = await barrier.holdReservation(slot.reservationId)
  const worker = await workerFactory()
  const wait = await barrier.waitForBlocked({
    baselinePids,
    lockerPid: holder.lockerPid,
    workers: [workerIdentity("worker", worker, functionName)],
  })
  holder.release()
  await holder.done
  return { wait, worker: await worker.promise }
}

async function cancelWorker({ getProvision, getServer, reason, slot }) {
  const provision = getProvision()
  const learner = fixtureUsers.find((user) => user.key === "learner")
  if (!learner) throw new Error("Missing learner fixture user")
  return createCancellationWorker({
    baseUrl: getServer().baseUrl,
    cookieJar: await createLearnerCookieJar({
      email: learner.email,
      password: provision.runPassword,
      status: provision.status,
    }),
    reason,
    reservationId: slot.reservationId,
  })
}

function observeSettlement(label, promise, settledOrder, settledAtHrtimeNs) {
  return promise.then(
    (value) => recordSettlement(label, value, settledOrder, settledAtHrtimeNs),
    (error) => {
      recordSettlement(label, null, settledOrder, settledAtHrtimeNs)
      throw error
    },
  )
}

function recordSettlement(label, value, settledOrder, settledAtHrtimeNs) {
  settledAtHrtimeNs[label] = process.hrtime.bigint().toString()
  settledOrder.push(label)
  return value
}

function completeResult(label, value, settledAtHrtimeNs) {
  return { ...value, finishedAtHrtimeNs: settledAtHrtimeNs[label], label }
}

function workerIdentity(label, worker, functionNames, pid) {
  return {
    functionNames: Array.isArray(functionNames) ? functionNames : [functionNames],
    label,
    pid,
    startedAtHrtimeNs: worker.startedAtHrtimeNs,
    startedAtWallMs: worker.startedAtWallMs,
  }
}
