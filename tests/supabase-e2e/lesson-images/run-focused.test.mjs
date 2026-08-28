import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import { createFocusedRunner } from "./runtime/focused-runner.mjs"
import { runExactLessonImageTest } from "./runtime/test-child.mjs"

test("focused runner preserves a valid pre-existing runtime", async () => {
  const calls = []
  const runner = createFocusedRunner(createDependencies(calls, async () => calls.push("read")))

  const result = await runner.run({ holdMs: 0, label: "existing" })

  assert.equal(result.exitCode, 0)
  assert.deepEqual(calls, ["read"])
})

test("focused runner starts, resets, stops, and verifies a fresh owned runtime", async () => {
  const calls = []
  const notRunning = Object.assign(new Error("not running"), { code: "supabase_not_running" })
  const runner = createFocusedRunner(
    createDependencies(calls, async () => {
      calls.push("read")
      throw notRunning
    }),
  )

  const result = await runner.run({ holdMs: 0, label: "fresh" })

  assert.equal(result.exitCode, 0)
  assert.deepEqual(calls, ["read", "start", "reset", "stop", "assert-stopped"])
})

test("focused runner propagates SIGTERM to the active suite and returns signal exit", async () => {
  const activeChild = {
    killSignals: [],
    kill(signal) {
      this.killSignals.push(signal)
    },
  }
  let releaseSuite
  const suiteDone = new Promise((resolve) => {
    releaseSuite = resolve
  })
  const runner = createFocusedRunner({
    ...createDependencies([], async () => {}),
    runSuite: async (_label, hooks) => {
      hooks.onSpawn(activeChild)
      return suiteDone
    },
  })
  const running = runner.run({ holdMs: 0, label: "signal" })
  await new Promise((resolve) => setImmediate(resolve))

  runner.receiveSignal("SIGTERM")
  releaseSuite({ exitCode: 1, signal: "SIGTERM", stderr: "", stdout: "" })
  const result = await running

  assert.deepEqual(activeChild.killSignals, ["SIGTERM"])
  assert.equal(result.exitCode, 143)
})

test("focused runner completes owned cleanup after forwarding SIGTERM", async () => {
  const calls = []
  const notRunning = Object.assign(new Error("not running"), { code: "supabase_not_running" })
  let releaseSuite
  const suiteDone = new Promise((resolve) => {
    releaseSuite = resolve
  })
  const runner = createFocusedRunner({
    ...createDependencies(calls, async () => {
      calls.push("read")
      throw notRunning
    }),
    runSuite: async (_label, hooks) => {
      const child = { kill: (signal) => calls.push(`kill:${signal}`) }
      hooks.onSpawn(child)
      calls.push("suite")
      return suiteDone
    },
  })
  const running = runner.run({ holdMs: 0, label: "signal-cleanup" })
  await new Promise((resolve) => setImmediate(resolve))

  runner.receiveSignal("SIGTERM")
  releaseSuite({ exitCode: 1, signal: "SIGTERM", stderr: "", stdout: "" })
  const result = await running

  assert.equal(result.exitCode, 143)
  assert.deepEqual(calls, [
    "read",
    "start",
    "reset",
    "suite",
    "kill:SIGTERM",
    "stop",
    "assert-stopped",
  ])
})

test("suite child uses the exact test target and is force-killed at its deadline", async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killSignals = []
  child.kill = (signal) => {
    child.killSignals.push(signal)
    queueMicrotask(() => child.emit("close", null, signal))
  }
  const spawns = []
  let timeoutCallback
  const resultPromise = runExactLessonImageTest(
    "deadline",
    {},
    {
      clearTimeout: () => {},
      cwd: "/repo",
      env: {},
      execPath: "/node",
      setTimeout: (callback) => {
        timeoutCallback = callback
        return 1
      },
      spawn: (...args) => {
        spawns.push(args)
        return child
      },
    },
  )

  timeoutCallback()
  const result = await resultPromise

  assert.deepEqual(spawns[0].slice(0, 2), [
    "/node",
    ["--test", "tests/supabase-e2e/lesson-images.test.mjs"],
  ])
  assert.deepEqual(child.killSignals, ["SIGKILL"])
  assert.equal(result.signal, "SIGKILL")
})

test("concurrent focused children receive distinct deterministic run namespaces", async () => {
  const first = await captureChildEnvironment("parallel-a")
  const second = await captureChildEnvironment("parallel-b")

  assert.equal(first.SPOLINK_TASK9_RUN_ID, "parallel-a")
  assert.equal(second.SPOLINK_TASK9_RUN_ID, "parallel-b")
  assert.notEqual(first.SPOLINK_TASK9_RUN_ID, second.SPOLINK_TASK9_RUN_ID)
})

function createDependencies(calls, readStatus) {
  return {
    assertStopped: async () => calls.push("assert-stopped"),
    readStatus,
    reset: async () => calls.push("reset"),
    runSuite: async () => ({ exitCode: 0, signal: null, stderr: "", stdout: "ok" }),
    start: async () => calls.push("start"),
    stop: async () => calls.push("stop"),
  }
}

async function captureChildEnvironment(label) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  let childEnvironment = null
  const result = runExactLessonImageTest(
    label,
    {},
    {
      clearTimeout: () => {},
      cwd: "/repo",
      env: {},
      execPath: "/node",
      setTimeout: () => 1,
      spawn: (_executable, _arguments, options) => {
        childEnvironment = options.env
        queueMicrotask(() => child.emit("close", 0, null))
        return child
      },
    },
  )
  await result
  return childEnvironment
}
