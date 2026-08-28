import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { EventEmitter } from "node:events"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import { errorCode, runLocalDev } from "../../scripts/dev-local.mjs"
import { LocalSupabaseNotRunningError } from "../../scripts/supabase-local/local-status.mjs"

import "./local-dev-status.test.mjs"

const execFileAsync = promisify(execFile)

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

test("primary startup failure plus cleanup exposes both redacted CLI dimensions", async () => {
  // Given: a fake dependency graph with distinct readiness and cleanup failures.
  const result = await runDevLocalSubprocess("primary-plus-cleanup")

  // When/Then: the real CLI boundary reports both stable dimensions and no fixture secret.
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr.trim(), "local dev failed: runtime_failed_cleanup_failed")
  assert.doesNotMatch(result.stderr, /sb_secret_|fixture-auth-flow-secret/)
})

test("cleanup-only aggregate retains cleanup_failed CLI classifier", async () => {
  // Given: a fake dependency graph where normal Next exit is followed only by cleanup failure.
  const result = await runDevLocalSubprocess("cleanup-only")

  // When/Then: the real CLI boundary preserves the established cleanup-only code.
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr.trim(), "local dev failed: cleanup_failed")
  assert.doesNotMatch(result.stderr, /fixture-auth-flow-secret/)
})

test("primary startup failure with successful cleanup retains its existing CLI code", async () => {
  // Given: a fake dependency graph where only readiness fails.
  const result = await runDevLocalSubprocess("primary-only")

  // When/Then: the existing primary code remains unchanged and redacted.
  assert.equal(result.exitCode, 1)
  assert.equal(result.stderr.trim(), "local dev failed: runtime_failed")
  assert.doesNotMatch(result.stderr, /sb_secret_/)
})

test("unmarked malformed and nested aggregates remain cleanup-only without message parsing", () => {
  // Given: aggregates that cannot be structurally identified as a launcher primary failure.
  const malformed = new AggregateError([null, "fixture-auth-flow-secret"])
  const nested = new AggregateError([new AggregateError([new Error("sb_secret_fixture")])])

  // When/Then: they retain the cleanup-only fallback and never inspect raw messages.
  assert.equal(errorCode(malformed), "cleanup_failed")
  assert.equal(errorCode(nested), "cleanup_failed")
})

test("cleanup-only aggregation cannot inherit a prior primary error marker", async () => {
  // Given: one Error object first used as a primary and later reused by cleanup.
  const sharedError = new Error("synthetic reusable failure")
  const primaryFixture = lifecycleFixture({ status: "stopped", resources: false })
  primaryFixture.runtime.startNext = async () => {
    primaryFixture.calls.push("next")
    throw sharedError
  }
  const primary = await rejectionOf(runLocalDev(primaryFixture.options))

  const cleanupFixture = lifecycleFixture({ status: "stopped", resources: false })
  cleanupFixture.runtime.stopSupabase = async () => {
    cleanupFixture.calls.push("stop")
    throw sharedError
  }

  // When/Then: only an aggregate structurally created around a primary gets the combined code.
  const cleanup = await rejectionOf(runLocalDev(cleanupFixture.options))
  assert.equal(errorCode(primary), "runtime_failed")
  assert.equal(errorCode(cleanup), "cleanup_failed")
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

async function runDevLocalSubprocess(scenario) {
  const harnessDir = await mkdtemp(path.join(tmpdir(), "spolink-dev-local-"))
  const loaderPath = path.join(harnessDir, "fake-dependencies-loader.mjs")
  try {
    await writeFile(loaderPath, fakeDependencyLoader)
    try {
      await execFileAsync(
        process.execPath,
        ["--no-warnings", "--experimental-loader", loaderPath, "scripts/dev-local.mjs"],
        {
          cwd: path.resolve(new URL("../..", import.meta.url).pathname),
          env: { SPOLINK_DEV_LOCAL_HARNESS_SCENARIO: scenario },
          timeout: 5_000,
        },
      )
      assert.fail("Expected dev:local subprocess to fail")
    } catch (error) {
      assert.equal(error?.code, 1)
      return { exitCode: error.code, stderr: error.stderr, stdout: error.stdout }
    }
  } finally {
    await rm(harnessDir, { force: true, recursive: true })
  }
}

const fakeDependencyLoader = `
const scenario = process.env.SPOLINK_DEV_LOCAL_HARNESS_SCENARIO
const modules = {
  "node:net": "import { EventEmitter } from 'node:events'; export function createServer() { const server = new EventEmitter(); server.listen = (_port, _host, callback) => { callback(); return server }; server.close = (callback) => callback(); return server } export default { createServer }",
  "./supabase-local/app-env.mjs": "export const buildLocalAppEnv = () => ({ sealed: true })",
  "./supabase-local/constants.mjs": "export const RUNTIME_RECEIPT_PATH = 'runtime.json'",
  "./supabase-local/docker.mjs": "export const scanProjectResources = async () => ({ containers: [], volumes: [], networks: [] })",
  "./supabase-local/lifecycle.mjs": \`export const runStart = async () => ({}); export const runStop = async () => { if (process.env.SPOLINK_DEV_LOCAL_HARNESS_SCENARIO !== "primary-only") throw new Error("synthetic cleanup failure fixture-auth-flow-secret") }\`,
  "./supabase-local/local-status.mjs": \`let reads = 0; export class LocalSupabaseNotRunningError extends Error {}; export const readGuardedLocalStatus = async () => { reads += 1; if (reads === 1) throw new LocalSupabaseNotRunningError(); return {} }\`,
  "./supabase-local/next-dev.mjs": \`const scenario = process.env.SPOLINK_DEV_LOCAL_HARNESS_SCENARIO; export const startNextDev = async () => scenario === "cleanup-only" ? { closed: Promise.resolve(), stop: async () => {} } : Promise.reject(new Error("synthetic readiness failure sb_secret_must_not_reach_cli"))\`,
  "./supabase-local/receipt.mjs": "export const maybeReadRuntimeReceipt = async () => null; export const readRuntimeReceipt = async () => ({ runId: 'fixture' })",
  "./supabase-local/stopped-state.mjs": "export const assertStoppedState = async () => ({})",
  "./supabase-local/utils.mjs": "export const absoluteEvidencePath = () => 'fixture-receipt'",
}
export async function resolve(specifier, context, nextResolve) {
  const source = modules[specifier]
  if (source) return { shortCircuit: true, url: \`data:text/javascript,\${encodeURIComponent(source)}\` }
  return nextResolve(specifier, context)
}
`
