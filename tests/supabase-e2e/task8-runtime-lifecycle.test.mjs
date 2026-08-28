import assert from "node:assert/strict"
import test from "node:test"

import {
  cleanupSupabaseRuntime,
  createCleanupCoordinator,
  createSignalCleanupHandler,
  prepareSupabaseRuntime,
} from "./task8/runtime-lifecycle.mjs"

const status = Object.freeze({
  anonKey: "local-anon",
  apiUrl: "http://127.0.0.1:54321",
  dbUrl: "postgresql://local",
  serviceRoleKey: "local-service",
})

test("full runner reuses a valid guarded runtime without reset or stop", async () => {
  const calls = []
  const runtime = await prepareSupabaseRuntime({
    readStatus: async () => status,
    reset: async () => calls.push("reset"),
    start: async () => calls.push("start"),
  })

  assert.equal(runtime.mode, "reused")
  assert.deepEqual(calls, [])

  const cleanup = await cleanupSupabaseRuntime(runtime, {
    assertStopped: async () => calls.push("assert-stopped"),
    readStatus: async () => ({ ...status }),
    stop: async () => calls.push("stop"),
    writePreservedReceipt: async (receipt) => calls.push(receipt),
  })

  assert.equal(cleanup.kind, "preserved")
  assert.equal(cleanup.receipt.bindingSha256, runtime.bindingSha256)
  assert.deepEqual(
    calls.map((call) => (typeof call === "string" ? call : call.status)),
    ["preserved"],
  )
})

test("full runner owns reset and cleanup only for a fresh guarded runtime", async () => {
  const calls = []
  let reads = 0
  const runtime = await prepareSupabaseRuntime({
    readStatus: async () => {
      reads += 1
      if (reads === 1)
        throw Object.assign(new Error("not running"), { code: "supabase_not_running" })
      return status
    },
    reset: async () => calls.push("reset"),
    start: async () => calls.push("start"),
  })

  assert.equal(runtime.mode, "owned")
  assert.match(runtime.bindingSha256, /^[a-f0-9]{64}$/u)
  assert.deepEqual(calls, ["start", "reset"])

  const cleanup = await cleanupSupabaseRuntime(runtime, {
    assertStopped: async () => calls.push("assert-stopped"),
    commitOwnedProof: async () => calls.push("proof"),
    readStatus: async () => status,
    stop: async () => calls.push("stop"),
    writePreservedReceipt: async () => calls.push("preserved"),
  })

  assert.equal(cleanup.kind, "stopped")
  assert.deepEqual(calls, ["start", "reset", "stop", "assert-stopped", "proof"])
})

test("full runner rejects non-absence status errors and changed reused runtime identity", async () => {
  await assert.rejects(
    prepareSupabaseRuntime({
      readStatus: async () => {
        throw Object.assign(new Error("invalid guard"), { code: "invalid_guard" })
      },
      reset: async () => {},
      start: async () => {},
    }),
    /invalid guard/u,
  )

  const runtime = await prepareSupabaseRuntime({
    readStatus: async () => status,
    reset: async () => {},
    start: async () => {},
  })
  await assert.rejects(
    cleanupSupabaseRuntime(runtime, {
      assertStopped: async () => {},
      readStatus: async () => ({ ...status, apiUrl: "http://127.0.0.1:59999" }),
      stop: async () => {},
      writePreservedReceipt: async () => {},
    }),
    /identity changed/u,
  )
})

test("fresh start publishes ownership before reset or post-reset status can fail", async (t) => {
  for (const failedStage of ["reset", "status"]) {
    await t.test(failedStage, async () => {
      const calls = []
      let published = null
      let reads = 0
      await assert.rejects(
        prepareSupabaseRuntime({
          publishOwnedRuntime: (runtime) => {
            published = runtime
            calls.push("owned")
          },
          readStatus: async () => {
            reads += 1
            if (reads === 1) {
              throw Object.assign(new Error("not running"), { code: "supabase_not_running" })
            }
            if (failedStage === "status") throw new Error("status failed")
            return status
          },
          reset: async () => {
            calls.push("reset")
            if (failedStage === "reset") throw new Error("reset failed")
          },
          start: async () => calls.push("start"),
        }),
        new RegExp(`${failedStage} failed`, "u"),
      )

      assert.equal(published?.mode, "owned")
      assert.equal(published?.cleanup.state, "pending")
      assert.deepEqual(calls.slice(0, 2), ["start", "owned"])

      const cleanupCalls = []
      await cleanupSupabaseRuntime(published, {
        assertStopped: async () => cleanupCalls.push("assert-stopped"),
        commitOwnedProof: async () => cleanupCalls.push("proof"),
        readStatus: async () => status,
        stop: async () => cleanupCalls.push("stop"),
        writePreservedReceipt: async () => cleanupCalls.push("preserved"),
      })
      assert.deepEqual(cleanupCalls, ["stop", "assert-stopped", "proof"])
      assert.equal(published.cleanup.state, "completed")
    })
  }
})

test("owned cleanup retries stop or assert failure without an early completion proof", async (t) => {
  for (const failedStage of ["stop", "assert-stopped"]) {
    await t.test(failedStage, async () => {
      let published = null
      let reads = 0
      await prepareSupabaseRuntime({
        publishOwnedRuntime: (runtime) => {
          published = runtime
        },
        readStatus: async () => {
          reads += 1
          if (reads === 1)
            throw Object.assign(new Error("not running"), { code: "supabase_not_running" })
          return status
        },
        reset: async () => {},
        start: async () => {},
      })

      let failed = false
      let proofCount = 0
      let stopCount = 0
      let assertCount = 0
      const dependencies = {
        assertStopped: async () => {
          assertCount += 1
          if (failedStage === "assert-stopped" && !failed) {
            failed = true
            throw new Error("assert failed")
          }
        },
        commitOwnedProof: async () => {
          proofCount += 1
        },
        readStatus: async () => status,
        stop: async () => {
          stopCount += 1
          if (failedStage === "stop" && !failed) {
            failed = true
            throw new Error("stop failed")
          }
        },
        writePreservedReceipt: async () => {},
      }

      await assert.rejects(cleanupSupabaseRuntime(published, dependencies), /failed/u)
      assert.equal(published.cleanup.state, "pending")
      assert.equal(proofCount, 0)

      await cleanupSupabaseRuntime(published, dependencies)
      assert.equal(published.cleanup.state, "completed")
      assert.equal(proofCount, 1)
      assert.equal(stopCount, failedStage === "stop" ? 2 : 1)
      assert.equal(assertCount, failedStage === "assert-stopped" ? 2 : 1)

      await cleanupSupabaseRuntime(published, dependencies)
      assert.equal(proofCount, 1)
      assert.equal(stopCount, failedStage === "stop" ? 2 : 1)
      assert.equal(assertCount, failedStage === "assert-stopped" ? 2 : 1)
    })
  }
})

test("signal and finally cleanup share in-progress work and permit signal retry", async () => {
  let releaseStop
  const stopBarrier = new Promise((resolve) => {
    releaseStop = resolve
  })
  let stopCount = 0
  let failFirst = true
  let proofCount = 0
  const runtime = {
    bindingSha256: null,
    cleanup: {
      assertCompleted: false,
      inFlight: null,
      result: null,
      state: "pending",
      stopCompleted: false,
    },
    mode: "owned",
    status: null,
  }
  const dependencies = {
    assertStopped: async () => {},
    commitOwnedProof: async () => {
      proofCount += 1
    },
    readStatus: async () => status,
    stop: async () => {
      stopCount += 1
      await stopBarrier
      if (failFirst) {
        failFirst = false
        throw new Error("signal stop failed")
      }
    },
    writePreservedReceipt: async () => {},
  }
  const coordinator = createCleanupCoordinator(() => cleanupSupabaseRuntime(runtime, dependencies))
  const exits = []
  const errors = []
  const signalHandler = createSignalCleanupHandler({
    cleanup: () => coordinator.run("signal"),
    exit: (code) => exits.push(code),
    recordError: (error) => errors.push(error),
  })

  const signalAttempt = signalHandler("SIGINT")
  const finallyAttempt = coordinator.run("finally")
  assert.equal(coordinator.state, "in-progress")
  releaseStop()
  await Promise.all([signalAttempt, assert.rejects(finallyAttempt, /signal stop failed/u)])
  assert.equal(stopCount, 1)
  assert.equal(coordinator.state, "pending")
  assert.equal(errors.length, 1)
  assert.deepEqual(exits, [])
  assert.equal(proofCount, 0)

  await signalHandler("SIGINT")
  assert.equal(coordinator.state, "completed")
  assert.equal(stopCount, 2)
  assert.equal(proofCount, 1)
  assert.deepEqual(exits, [130])
})
