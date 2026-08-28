import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { assertRaceResultOrder } from "./cancellation-concurrency/slots.mjs"
import * as barrierModule from "./database-barrier.mjs"

test("transport diagnostic accepts B-before-A but rejects duplicate settlement labels", () => {
  const result = validRaceResult()
  assert.doesNotThrow(() =>
    assertRaceResultOrder(result, { A: "cancel_reservation", B: "cancel_reservation" }),
  )
  assert.throws(
    () =>
      assertRaceResultOrder(
        { ...result, settledOrder: ["A", "A"] },
        { A: "cancel_reservation", B: "cancel_reservation" },
      ),
    /transport|settled|unique/i,
  )
})

test("race oracle rejects exact function-name mismatch", () => {
  assert.throws(
    () =>
      assertRaceResultOrder(validRaceResult(), {
        A: "cancel_reservation",
        B: "confirm_paid_reservation",
      }),
    /Expected values to be strictly equal/,
  )
})

test("wait identity rejects a matching candidate started before its worker", () => {
  const candidate = {
    pid: 101,
    query: "select public.cancel_reservation()",
    queryStartMs: 999,
    stateChangeMs: 999,
  }
  const worker = {
    functionNames: ["cancel_reservation"],
    label: "A",
    startedAtWallMs: 1_000,
  }

  assert.equal(barrierModule.matchesWorkerIdentity(candidate, worker), false)
})

test("owned blocker-chain proof rejects a chain that does not reach the locker", () => {
  const waiter = { blockers: [102], pid: 101 }
  const unrelated = { blockers: [103], pid: 102 }
  const candidates = new Map([
    [waiter.pid, waiter],
    [unrelated.pid, unrelated],
  ])

  assert.equal(barrierModule.findOwnedBlockerChain(waiter, candidates, 999), null)
})

test("notification snapshot ordering stays lexical across PostgreSQL storage type changes", async () => {
  const source = await readFile("tests/supabase-e2e/cancellation-concurrency/state.mjs", "utf8")

  assert.match(source, /order by row\.type::text, row\.user_id::text/u)
})

function validRaceResult() {
  const waitA = {
    baselineExcluded: true,
    blockerChain: [101, 999],
    lockerPid: 999,
    matchedFunction: "cancel_reservation",
    pid: 101,
    queryStartMs: 1_001,
    stateChangeMs: 1_001,
    workerLabel: "A",
    workerStartedAtWallMs: 1_000,
  }
  const waitB = {
    ...waitA,
    blockerChain: [102, 101, 999],
    pid: 102,
    queryStartMs: 1_101,
    stateChangeMs: 1_101,
    workerLabel: "B",
    workerStartedAtWallMs: 1_100,
  }
  return {
    A: { finishedAtHrtimeNs: "2", label: "A" },
    B: { finishedAtHrtimeNs: "1", label: "B" },
    settledOrder: ["B", "A"],
    waits: {
      A: [waitA],
      B: [waitA, waitB],
    },
  }
}
