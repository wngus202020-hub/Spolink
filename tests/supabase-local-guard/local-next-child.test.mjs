import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { chmodSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { startNextDev } from "../../scripts/supabase-local/next-dev.mjs"
import {
  createRuntimeReceipt,
  readRuntimeReceipt,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local/receipt.mjs"

const expectedArgs = "pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3000".split(" ")
const appEnv = {
  PATH: "/fixture/bin",
  HOME: "/fixture/home",
  TMPDIR: "/fixture/tmp",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_fixture",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
  SPOLINK_AUTH_FLOW_SECRET: "fixture-auth-flow-secret",
}

test("spawns exact fixed-port argv/env and registers then removes ownership", async () => {
  await withFixture(async ({ receiptPath }) => {
    const calls = []
    const child = fakeChild(4101)
    const runtime = fakeRuntime(child, calls, [true])
    const next = await start(receiptPath, runtime, { repoRoot: "/fixture/repo" })

    assert.deepEqual(calls[0], {
      command: "corepack",
      args: expectedArgs,
      options: {
        cwd: "/fixture/repo",
        env: appEnv,
        detached: true,
        shell: false,
        stdio: "inherit",
      },
    })
    const stored = await readRuntimeReceipt(receiptPath)
    assert.deepEqual([stored.ownedPids, stored.selectedNextPorts], [[4101], [3000]])

    child.exit(0)
    await next.closed
    assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
    assert.equal(child.observations.at(-1), "port-free")
  })
})

test("occupied port fails before spawn, readiness, or receipt mutation", async () => {
  await withFixture(async ({ receiptPath }) => {
    const calls = []
    const runtime = fakeRuntime(fakeChild(4102), calls, [true])
    runtime.reservePort = async () => null
    await assert.rejects(
      startNextDev({ runId: "run-next", receiptPath, appEnv, runtime }),
      /127\.0\.0\.1:3000.*occupied/i,
    )
    assert.equal(calls.length, 0)
    assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
  })
})

test("spawn errors and stale receipts leave ownership unchanged", async (t) => {
  await t.test("spawn error", async () => {
    await withFixture(async ({ receiptPath }) => {
      const child = fakeChild(4107)
      const runtime = fakeRuntime(child, [], [true])
      runtime.spawnChild = () => {
        queueMicrotask(() => child.emit("error", new Error("synthetic spawn failure")))
        return child
      }
      await assert.rejects(
        startNextDev({ runId: "run-next", receiptPath, appEnv, runtime }),
        /synthetic spawn failure/,
      )
      assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
    })
  })
  await t.test("stale receipt", async () => {
    await withFixture(async ({ receiptPath }) => {
      const current = await readRuntimeReceipt(receiptPath)
      await writeRuntimeReceipt(receiptPath, {
        ...current,
        runId: "stale-run",
        ownedRuntimeDirs: { runId: "stale-run", paths: [] },
      })
      const calls = []
      await assert.rejects(
        start(receiptPath, fakeRuntime(fakeChild(4108), calls, [true])),
        /stale.*runId/i,
      )
      assert.equal(calls.length, 0)
    })
  })
})

test("post-spawn receipt failure terminates only the owned child and releases resources", async () => {
  await withFixture(async ({ receiptPath }) => {
    const child = fakeChild(4109)
    const unrelated = fakeChild(4110)
    child.onKill = (signal) => signal === "SIGKILL" && child.exit(null, signal)
    const runtime = fakeRuntime(child, [], [true])
    const receiptDir = path.dirname(receiptPath)
    runtime.beforeSpawn = () => chmodSync(receiptDir, 0o500)
    const signalListeners = ["SIGINT", "SIGTERM"].map((name) =>
      runtime.signalSource.listenerCount(name),
    )

    try {
      await assert.rejects(
        start(receiptPath, runtime, { terminateGraceMs: 1 }),
        (error) => error?.code === "EACCES" && !error.message.includes("sb_secret_fixture"),
      )
    } finally {
      chmodSync(receiptDir, 0o700)
    }

    assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"])
    assert.deepEqual(unrelated.kills, [])
    assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
    assert.equal(runtime.reservationReleases, 1)
    assert.deepEqual(
      ["SIGINT", "SIGTERM"].map((name) => runtime.signalSource.listenerCount(name)),
      signalListeners,
    )
  })
})

test("malformed readiness times out, terminates, unregisters, and never changes port", async () => {
  await withFixture(async ({ receiptPath }) => {
    const calls = []
    const child = fakeChild(4103)
    child.onKill = () => child.exit(null, "SIGTERM")
    const runtime = fakeRuntime(child, calls, [{ configured: "yes" }, null, false])
    await assert.rejects(
      start(receiptPath, runtime, { readinessTimeoutMs: 2, pollIntervalMs: 1 }),
      /readiness timed out/i,
    )
    assert.deepEqual(child.kills, ["SIGTERM"])
    assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
  })
})

test("SIGINT is idempotent and SIGTERM falls back to bounded SIGKILL", async (t) => {
  for (const scenario of [
    { signal: "SIGINT", closesOn: "SIGINT", expected: ["SIGINT"] },
    { signal: "SIGTERM", closesOn: "SIGKILL", expected: ["SIGTERM", "SIGKILL"] },
  ]) {
    await t.test(scenario.signal, async () => {
      await withFixture(async ({ receiptPath }) => {
        const child = fakeChild(scenario.signal === "SIGINT" ? 4104 : 4105)
        child.onKill = (signal) => {
          if (signal === scenario.closesOn) child.exit(null, signal)
        }
        const runtime = fakeRuntime(child, [], [true])
        const next = await start(receiptPath, runtime, { terminateGraceMs: 1 })
        runtime.signalSource.emit(scenario.signal)
        runtime.signalSource.emit(scenario.signal)
        await next.closed
        assert.deepEqual(child.kills, scenario.expected)
        assert.deepEqual((await readRuntimeReceipt(receiptPath)).ownedPids, [])
      })
    })
  }
})

test("mismatched runId, PID, or port refuses every kill and receipt write", async (t) => {
  for (const mismatch of [
    {
      runId: "other-run",
      ownedPids: [4106],
      selectedNextPorts: [3000],
      ownedRuntimeDirs: { runId: "other-run", paths: [] },
    },
    { runId: "run-next", ownedPids: [9999], selectedNextPorts: [3000] },
    { runId: "run-next", ownedPids: [4106], selectedNextPorts: [3999] },
  ]) {
    await t.test(JSON.stringify(mismatch), async () => {
      await withFixture(async ({ receiptPath }) => {
        const child = fakeChild(4106)
        const runtime = fakeRuntime(child, [], [true])
        const next = await startNextDev({ runId: "run-next", receiptPath, appEnv, runtime })
        const current = await readRuntimeReceipt(receiptPath)
        await writeRuntimeReceipt(receiptPath, { ...current, ...mismatch })
        await assert.rejects(next.stop("SIGTERM"), /ownership mismatch|runId/i)
        assert.deepEqual(child.kills, [])
        assert.deepEqual(await readRuntimeReceipt(receiptPath), { ...current, ...mismatch })
        child.exit(0)
        await assert.rejects(next.closed, /ownership mismatch|runId/i)
      })
    })
  }
})

async function withFixture(action) {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-next-child-"))
  const receiptPath = path.join(dir, "runtime.json")
  try {
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({ runId: "run-next", dockerOwnership: "preexisting" }),
    )
    await action({ receiptPath })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.kills = []
  child.observations = []
  child.kill = (signal) => {
    child.kills.push(signal)
    child.onKill?.(signal)
    return true
  }
  child.exit = (code, signal = null) => child.emit("close", code, signal)
  return child
}

function start(receiptPath, runtime, options = {}) {
  return startNextDev({ runId: "run-next", receiptPath, appEnv, runtime, ...options })
}

function fakeRuntime(child, calls, readiness) {
  let now = 0
  let reservationReleased = false
  const signalSource = new EventEmitter()
  const runtime = {
    signalSource,
    reservationReleases: 0,
    reservePort: async () => ({
      release: async () => {
        if (reservationReleased) return
        reservationReleased = true
        runtime.reservationReleases += 1
      },
    }),
    spawnChild: (command, args, options) => {
      calls.push({ command, args, options })
      runtime.beforeSpawn?.()
      queueMicrotask(() => child.emit("spawn"))
      return child
    },
    readConfigured: async function readConfigured(url) {
      assert.equal(url, "http://127.0.0.1:3000/api/config/supabase")
      child.observations.push("readiness")
      return readiness.shift()
    },
    now: () => now,
    isPortFree: async () => child.observations.push("port-free") > 0,
    killChild: (target, signal) => target.kill(signal),
    sleep: async (ms) => {
      now += ms
    },
  }
  return runtime
}
