import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { runLocalDev } from "../../scripts/dev-local.mjs"
import { LocalSupabaseNotRunningError } from "../../scripts/supabase-local/local-status.mjs"

import "./local-dev-status.test.mjs"

test("branch table preserves ownership and applies exact cleanup", async (t) => {
  for (const scenario of [
    { name: "occupied", occupied: true, expected: "occupied", calls: ["port"] },
    {
      name: "fresh",
      status: "stopped",
      resources: false,
      expected: true,
      calls: [
        "port",
        "status",
        "resources",
        "receipt",
        "start",
        "status",
        "next",
        "next-stop",
        "stop",
        "assert",
      ],
    },
    {
      name: "reuse",
      status: "healthy",
      receipt: "current",
      expected: false,
      calls: ["port", "status", "receipt", "next", "next-stop"],
    },
    ...["missing", "stale", "mismatched", "malformed"].map((receipt) => ({
      name: `${receipt} receipt`,
      status: "healthy",
      receipt,
      expected: "receipt",
      calls: ["port", "status", "receipt"],
    })),
    {
      name: "stale resources",
      status: "stopped",
      resources: true,
      expected: "unowned_runtime",
      calls: ["port", "status", "resources"],
    },
  ]) {
    await t.test(scenario.name, async () => {
      // Given: one exact local runtime branch.
      const fixture = lifecycleFixture(scenario)

      // When: the guarded launcher runs or rejects.
      if (typeof scenario.expected === "boolean") {
        const result = await runLocalDev(fixture.options)
        assert.equal(result.startedByLauncher, scenario.expected)
      } else {
        const error = await rejectionOf(runLocalDev(fixture.options))
        assert.match(`${error.code} ${error.message}`, new RegExp(scenario.expected, "i"))
      }

      // Then: only the branch-authorized operations occurred.
      assert.deepEqual(fixture.calls, scenario.calls)
    })
  }
})

test("initial non-absence status failure rejects unchanged before lifecycle activity", async () => {
  const fixture = lifecycleFixture({ status: "healthy" })
  const sentinel = Object.assign(new Error("synthetic status permission failure"), {
    code: "EACCES",
  })
  fixture.runtime.readStatus = async () => {
    fixture.calls.push("status")
    throw sentinel
  }

  const error = await rejectionOf(runLocalDev(fixture.options))

  assert.equal(error, sentinel)
  assert.deepEqual(fixture.calls, ["port", "status"])
})

test("startup failure uses ownership-dependent cleanup", async () => {
  const fixture = lifecycleFixture({ status: "stopped", resources: false })
  fixture.runtime.startNext = async () => {
    fixture.calls.push("next")
    throw new Error("synthetic readiness failure")
  }

  await assert.rejects(runLocalDev(fixture.options), /synthetic readiness failure/)
  assert.deepEqual(fixture.calls, [
    "port",
    "status",
    "resources",
    "receipt",
    "start",
    "status",
    "next",
    "stop",
    "assert",
  ])
})

test("duplicate signals cause one Next cleanup and preserve reused Supabase", async () => {
  const fixture = lifecycleFixture({ status: "healthy", receipt: "current" })
  fixture.runtime.startNext = async () => {
    fixture.calls.push("next")
    let resolveClosed
    let stopped = false
    const closed = new Promise((resolve) => {
      resolveClosed = resolve
    })
    const stop = async () => {
      if (stopped) return
      stopped = true
      fixture.calls.push("next-stop")
      resolveClosed()
    }
    fixture.runtime.signalSource.on("SIGINT", stop)
    queueMicrotask(() => {
      fixture.runtime.signalSource.emit("SIGINT")
      fixture.runtime.signalSource.emit("SIGINT")
    })
    return { closed, stop }
  }

  const result = await runLocalDev(fixture.options)
  assert.equal(result.startedByLauncher, false)
  assert.deepEqual(fixture.calls, ["port", "status", "receipt", "next", "next-stop"])
})

test("cleanup failures aggregate without leaking credential-shaped state", async () => {
  // Given: an owned runtime with three independent cleanup failures and secret-bearing status.
  const fixture = lifecycleFixture({ status: "stopped", resources: false })
  fixture.runtime.startNext = async () => {
    fixture.calls.push("next")
    return {
      closed: Promise.resolve(),
      stop: async () => {
        fixture.calls.push("next-stop")
        throw new Error("next cleanup failed")
      },
    }
  }
  fixture.runtime.stopSupabase = async () => {
    fixture.calls.push("stop")
    throw new Error("supabase cleanup failed")
  }
  fixture.runtime.assertSupabaseStopped = async () => {
    fixture.calls.push("assert")
    throw new Error("assert cleanup failed")
  }

  // When: cleanup executes after normal Next exit.
  const error = await rejectionOf(runLocalDev(fixture.options))

  assert.ok(error instanceof AggregateError)
  assert.equal(error.errors.length, 3)
  assert.deepEqual(fixture.calls.slice(-3), ["next-stop", "stop", "assert"])
  const output = fixture.output.join("\n")
  assert.match(output, /"startedByLauncher":true/)
  assert.match(output, /http:\/\/127\.0\.0\.1:3000/)
  assert.doesNotMatch(output, /sb_secret_|sb_publishable_|fixture-auth-flow-secret/)
})

test("package command is exact and legacy commands are unchanged", async () => {
  // Given/When: package scripts are read as machine-consumed JSON.
  const packageJson = JSON.parse(
    await readFile(
      path.join(path.resolve(new URL("../..", import.meta.url).pathname), "package.json"),
    ),
  )

  // Then: the new command is exact and legacy command strings retain their semantics.
  assert.equal(packageJson.scripts["dev:local"], "node scripts/dev-local.mjs")
  assert.equal(packageJson.scripts.dev, "next dev --webpack --hostname 127.0.0.1")
  assert.equal(packageJson.scripts.build, "next build")
  assert.equal(packageJson.scripts.start, "next start --hostname 127.0.0.1")
})

function lifecycleFixture(scenario) {
  const calls = []
  const output = []
  let statusReads = 0
  const receipt = { runId: "run-local" }
  const runtime = {
    signalSource: new EventEmitter(),
    isNextPortFree: async () => {
      calls.push("port")
      return !scenario.occupied
    },
    readStatus: async () => {
      calls.push("status")
      statusReads += 1
      if (scenario.status === "stopped" && statusReads === 1) {
        throw new LocalSupabaseNotRunningError()
      }
      return fixtureStatus()
    },
    scanResources: async () => {
      calls.push("resources")
      return scenario.resources
        ? { containers: ["owned-identity"], volumes: [], networks: [] }
        : { containers: [], volumes: [], networks: [] }
    },
    readReceipt: async () => {
      calls.push("receipt")
      if (scenario.receipt && scenario.receipt !== "current") {
        throw new Error(`Runtime receipt ${scenario.receipt}`)
      }
      return receipt
    },
    startSupabase: async () => {
      calls.push("start")
      return receipt
    },
    buildAppEnv: () => ({ sealed: true }),
    startNext: async () => {
      calls.push("next")
      return { closed: Promise.resolve(), stop: async () => calls.push("next-stop") }
    },
    stopSupabase: async () => calls.push("stop"),
    assertSupabaseStopped: async () => calls.push("assert"),
    log: (value) => output.push(value),
  }
  return { calls, output, runtime, options: { runtime } }
}

function fixtureStatus() {
  return {
    projectId: "spolink",
    apiUrl: "http://127.0.0.1:54321",
    dbUrl: "postgresql://redacted@127.0.0.1:54322/postgres",
    anonKey: "sb_publishable_fixture",
    serviceRoleKey: "sb_secret_fixture",
  }
}

async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail("Expected promise to reject")
}
