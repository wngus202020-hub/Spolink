import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { LocalSupabaseNotRunningError } from "../scripts/supabase-local/local-status.mjs"
import { acquireMoneyOperationsRuntime } from "./money-operations-local-runtime.mjs"

test("reuses an already-running guarded Supabase runtime without claiming cleanup", async () => {
  const status = { dbUrl: "postgresql://local/reused" }
  const receipt = { runId: "preexisting-runtime" }
  let starts = 0
  let stops = 0
  const runtime = await acquireMoneyOperationsRuntime({
    readStatus: async () => status,
    readReceipt: async () => receipt,
    start: async () => {
      starts += 1
    },
    stop: async () => {
      stops += 1
    },
  })

  assert.equal(runtime.status, status)
  assert.equal(runtime.ownership, "reused")
  assert.equal(runtime.receipt, receipt)
  await runtime.release()
  assert.equal(starts, 0)
  assert.equal(stops, 0)
})

test("a stale stopped receipt cannot shadow the fresh runtime cleanup identity", async () => {
  const calls = []
  const status = { dbUrl: "postgresql://local/owned" }
  let reads = 0
  const runtime = await acquireMoneyOperationsRuntime({
    readStatus: async () => {
      reads += 1
      if (reads === 1) throw new LocalSupabaseNotRunningError()
      return status
    },
    start: async (options) => {
      calls.push(["start", options])
      return { dockerOwnership: "preexisting", runId: options.runId }
    },
    stop: async (identity) => {
      calls.push(["stop", identity])
    },
  })

  assert.equal(runtime.status, status)
  assert.equal(runtime.ownership, "owned")
  await runtime.release()
  const freshRunId = calls[0][1].runId
  assert.match(freshRunId, /^spolink-money-[a-f0-9]{32}$/u)
  assert.deepEqual(calls, [
    ["start", { runId: freshRunId }],
    ["stop", { dockerOwnership: "preexisting", runId: freshRunId }],
  ])
})

test("a fresh owned runtime is stopped when readiness fails", async () => {
  const primary = new Error("fresh runtime readiness failed")
  const stops = []
  let reads = 0

  await assert.rejects(
    acquireMoneyOperationsRuntime({
      readStatus: async () => {
        reads += 1
        if (reads === 1) throw new LocalSupabaseNotRunningError()
        throw primary
      },
      createRunId: () => "fresh-failure",
      start: async ({ runId }) => ({ dockerOwnership: "preexisting", runId }),
      stop: async (identity) => stops.push(identity),
    }),
    (error) => error === primary,
  )
  assert.deepEqual(stops, [{ dockerOwnership: "preexisting", runId: "fresh-failure" }])
})

test("SIGINT stops a fresh owned runtime before propagating the signal", async () => {
  const signalTarget = new EventEmitter()
  signalTarget.pid = 42
  const calls = []
  signalTarget.kill = (pid, signal) => calls.push(["kill", pid, signal])
  let reads = 0
  const runtime = await acquireMoneyOperationsRuntime({
    readStatus: async () => {
      reads += 1
      if (reads === 1) throw new LocalSupabaseNotRunningError()
      return { dbUrl: "postgresql://local/signal" }
    },
    createRunId: () => "fresh-signal",
    signalTarget,
    start: async ({ runId }) => ({ dockerOwnership: "preexisting", runId }),
    stop: async (identity) => calls.push(["stop", identity]),
  })

  signalTarget.emit("SIGINT")
  await runtime.signalCleanup
  assert.deepEqual(calls, [
    ["stop", { dockerOwnership: "preexisting", runId: "fresh-signal" }],
    ["kill", 42, "SIGINT"],
  ])
})

test("ambiguous running ownership fails closed without starting or stopping", async () => {
  const ambiguous = new Error("runtime receipt does not match running resources")
  let starts = 0
  let stops = 0

  await assert.rejects(
    acquireMoneyOperationsRuntime({
      readStatus: async () => ({ dbUrl: "postgresql://local/ambiguous" }),
      readReceipt: async () => {
        throw ambiguous
      },
      start: async () => {
        starts += 1
      },
      stop: async () => {
        stops += 1
      },
    }),
    (error) => error === ambiguous,
  )
  assert.equal(starts, 0)
  assert.equal(stops, 0)
})

test("cleanup failure preserves the primary failure and reports guarded residue", async () => {
  const primary = new Error("fresh runtime readiness failed")
  const residue = new Error("guarded stop left project resources")
  let reads = 0

  await assert.rejects(
    acquireMoneyOperationsRuntime({
      readStatus: async () => {
        reads += 1
        if (reads === 1) throw new LocalSupabaseNotRunningError()
        throw primary
      },
      createRunId: () => "fresh-residue",
      start: async ({ runId }) => ({ dockerOwnership: "preexisting", runId }),
      stop: async () => {
        throw residue
      },
    }),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.deepEqual(error.errors, [primary, residue])
      assert.match(error.message, /cleanup failed.*residue/u)
      return true
    },
  )
})

test("does not start a runtime for an unrelated status failure", async () => {
  const expected = new Error("status parse failed")
  let starts = 0

  await assert.rejects(
    acquireMoneyOperationsRuntime({
      readStatus: async () => {
        throw expected
      },
      start: async () => {
        starts += 1
      },
      stop: async () => {},
    }),
    (error) => error === expected,
  )
  assert.equal(starts, 0)
})
