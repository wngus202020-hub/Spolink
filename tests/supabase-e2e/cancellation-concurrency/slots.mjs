import assert from "node:assert/strict"

import { expandFixedId, raceSlots } from "../fixtures.mjs"

export function raceSlot(reservationSuffix) {
  const slot = raceSlots.find((candidate) => candidate.reservation === reservationSuffix)
  if (!slot) throw new Error(`Missing race slot: ${reservationSuffix}`)
  return {
    ...slot,
    paymentId: expandFixedId(slot.payment),
    providerKey: `local-provider-${slot.reservation}`,
    reservationId: expandFixedId(slot.reservation),
    scheduleId: expandFixedId(slot.suffix),
  }
}

export function providerEvidence(slot) {
  return {
    orderId: `spolink_${slot.reservationId}`,
    paymentKey: slot.providerKey,
    status: "DONE",
    totalAmount: 10001,
  }
}

export function assertRaceResultOrder(result, expectedFunctions) {
  assert.deepEqual([...result.settledOrder].sort(), ["A", "B"], "both transports settled once")
  assert.equal(new Set(result.settledOrder).size, 2, "transport settlement labels are unique")
  assert.equal(typeof result.A.finishedAtHrtimeNs, "string")
  assert.equal(typeof result.B.finishedAtHrtimeNs, "string")
  assert.equal(result.waits.A.length, 1)
  assert.equal(result.waits.B.length, 2)
  const waitA = result.waits.A[0]
  const secondA = result.waits.B.find((row) => row.workerLabel === "A")
  const waitB = result.waits.B.find((row) => row.workerLabel === "B")
  assert.ok(secondA)
  assert.ok(waitB)
  assert.notEqual(waitA.pid, waitB.pid)
  assert.notEqual(waitA.pid, waitA.lockerPid)
  assert.notEqual(waitB.pid, waitA.lockerPid)
  assert.deepEqual(waitA.blockerChain, [waitA.pid, waitA.lockerPid])
  assert.deepEqual(secondA.blockerChain, [waitA.pid, waitA.lockerPid])
  assert.deepEqual(waitB.blockerChain, [waitB.pid, waitA.pid, waitA.lockerPid])
  assert.equal(waitA.matchedFunction, expectedFunctions.A)
  assert.equal(secondA.matchedFunction, expectedFunctions.A)
  assert.equal(waitB.matchedFunction, expectedFunctions.B)
  for (const wait of [waitA, secondA, waitB]) {
    assert.equal(wait.baselineExcluded, true)
    assert.equal(wait.queryStartMs > wait.workerStartedAtWallMs, true)
    assert.equal(wait.stateChangeMs >= wait.workerStartedAtWallMs, true)
  }
}
