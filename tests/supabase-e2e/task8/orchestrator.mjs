import path from "node:path"
import { runStop } from "../../../scripts/supabase-local.mjs"
import { resolveSupabaseOutputDir } from "../../auth-ui-e2e/evidence-paths.mjs"
import { ensureAuthGatewayReady, provisionWithAuthReadiness } from "../auth-rls/runtime.mjs"
import { readGuardedLocalStatus } from "../local-status.mjs"
import {
  assertNextTypeStability,
  assertNoRootEnvFiles,
  capturePort3002,
  startNextServer,
} from "../next-server.mjs"
import { assertSupabaseSsrContracts } from "../ssr-cookie-jar.mjs"
import { appendTodo8RunEvidence, writeTodo8Summary } from "./evidence.mjs"
import { assertQaHoldRequest, assertSingleOwnedNext } from "./helpers.mjs"
import { runInternalQa } from "./internal-qa.mjs"
import { runCorepackPnpm, runNode, writeRedactedOutput } from "./process.mjs"
import { assertQaState, removeQaSideEffects, withQaSql } from "./qa-db.mjs"
import { createQaFiles, isReleased } from "./qa-files.mjs"
import { finalizeQaSuccess } from "./qa-proof.mjs"
import { restoreRecordedNextOwnership } from "./receipt-ownership.mjs"

export async function runTodo8() {
  const context = createContext()
  installSignalHandlers(context)
  let caughtError = null
  try {
    await setup(context)
    await runUnconfiguredApi(context)
    await runSupabaseCore(context)
    await runConfiguredE2e(context)
    await runQa(context)
    await stopConfiguredNext(context)
    await runStaticGates(context)
  } catch (error) {
    caughtError = error
  } finally {
    try {
      await cleanup(context)
    } catch (cleanupError) {
      caughtError ??= cleanupError
      context.cleanupError = cleanupError
    }
    if (!caughtError) {
      try {
        context.qaSuccess = await finalizeQaSuccess(`${context.outputDir}/assert-stopped.json`)
      } catch (proofError) {
        caughtError = proofError
      }
    }
    const injected = process.env.SPOLINK_E2E_INJECT_FAILURE === "after-next-ready"
    const summaryName = injected
      ? `injected-failure-summary-${Date.now()}-${process.pid}.json`
      : `integrated-summary-${Date.now()}-${process.pid}.json`
    const summaryPath = `${context.outputDir}/${summaryName}`
    await writeTodo8Summary(context, caughtError ? "failure" : "success", caughtError, summaryPath)
    await appendTodo8RunEvidence({
      exitCode: caughtError ? 1 : 0,
      qaSuccess: context.qaSuccess,
      summaryPath,
    })
  }
  if (caughtError) throw caughtError
}

function createContext() {
  return {
    before3002: null,
    children: [],
    cleanupError: null,
    configured: null,
    hold: assertQaHoldRequest({
      metadataPath: process.env.SPOLINK_E2E_QA_METADATA,
      seconds: process.env.SPOLINK_E2E_QA_HOLD_SECONDS,
    }),
    qaProvision: null,
    qaSuccess: null,
    recordedNext: [],
    status: null,
    unconfigured: null,
    outputDir: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs",
  }
}

async function setup(context) {
  context.outputDir = await resolveSupabaseOutputDir()
  await assertNoRootEnvFiles()
  await assertSupabaseSsrContracts()
  await assertNextTypeStability()
  context.before3002 = await capturePort3002()
  assertSingleOwnedNext(context.children)
}

async function runUnconfiguredApi(context) {
  context.unconfigured = await startNextServer({ mode: "unconfigured" })
  context.children.push({ pid: context.unconfigured.ownedPid, stopped: false })
  assertSingleOwnedNext(context.children)
  const result = await runCorepackPnpm(["test:api:contracts"], {
    controls: { baseUrl: context.unconfigured.baseUrl },
    envKind: "test-api",
    outputPath: `${context.outputDir}/test-api-unconfigured.json`,
  })
  if (result.exitCode !== 0) throw new Error("Unconfigured live test:api failed")
  context.recordedNext.push({ pid: context.unconfigured.ownedPid, port: context.unconfigured.port })
  await stopServer(context, "unconfigured")
}

async function runSupabaseCore(context) {
  await assertCommand(
    ["supabase:start"],
    "supabase-command",
    `${context.outputDir}/supabase-start.json`,
  )
  await restoreRecordedNextOwnership(context.recordedNext)
  await assertCommand(
    ["supabase:reset"],
    "supabase-command",
    `${context.outputDir}/supabase-reset-1.json`,
  )
  await assertNode(["tests/supabase-e2e/provision.mjs", "--pg-tap"], {
    controls: { baseUrl: "http://127.0.0.1:1" },
    outputPath: `${context.outputDir}/provision-pg-tap.json`,
  })
  await assertCommand(["supabase:test:db"], "supabase-command", `${context.outputDir}/pg-tap.json`)
  await assertCommand(
    ["supabase:reset"],
    "supabase-command",
    `${context.outputDir}/supabase-reset-2.json`,
  )
  await assertNode(["--test", "tests/supabase-e2e/auth-rls.test.mjs"], {
    controls: { baseUrl: "http://127.0.0.1:1" },
    outputPath: `${context.outputDir}/auth-rls.json`,
  })
  for (const file of [
    "tests/coach-certification/storage-e2e.mjs",
    "tests/coach-certification/submission-e2e.mjs",
    "tests/coach-certification/admin-review-e2e.mjs",
  ]) {
    await assertNode([file], {
      controls: { baseUrl: "http://127.0.0.1:1" },
      outputPath: `${context.outputDir}/${path.basename(file)}.json`,
    })
  }
  context.status = await readGuardedLocalStatus()
}

async function runConfiguredE2e(context) {
  await assertCommand(
    ["supabase:reset"],
    "supabase-command",
    `${context.outputDir}/supabase-reset-3.json`,
  )
  await ensureAuthGatewayReady()
  context.status = await readGuardedLocalStatus()
  context.configured = await startNextServer({ mode: "configured", status: context.status })
  context.children.push({ pid: context.configured.ownedPid, stopped: false })
  assertSingleOwnedNext(context.children)
  if (process.env.SPOLINK_E2E_INJECT_FAILURE === "after-next-ready") {
    throw new Error("Injected Todo8 failure after configured Next readiness")
  }
  for (const file of [
    "tests/supabase-e2e/cancellation-api.test.mjs",
    "tests/supabase-e2e/cancellation-policy.test.mjs",
    "tests/supabase-e2e/cancellation-concurrency.test.mjs",
  ]) {
    const result = await runNode(["--test", file], {
      controls: e2eControls(context.configured.baseUrl),
      outputPath: `${context.outputDir}/${path.basename(file)}.json`,
    })
    if (result.exitCode !== 0) throw new Error(`${file} failed`)
  }
}

async function runQa(context) {
  await assertCommand(
    ["supabase:reset"],
    "supabase-command",
    `${context.outputDir}/supabase-reset-qa.json`,
  )
  await ensureAuthGatewayReady()
  context.qaProvision = await provisionWithAuthReadiness()
  await withQaSql(async (sql) => {
    await removeQaSideEffects(sql)
  })
  await assertQaState("pristine")
  if (context.hold.enabled) {
    await createQaFiles({
      baseUrl: context.configured.baseUrl,
      metadataPath: context.hold.metadataPath,
      provision: context.qaProvision,
      status: context.status,
    })
    await waitForRelease(context.hold.metadataPath, context.hold.seconds)
  } else {
    await runInternalQa(context)
  }
}

async function stopConfiguredNext(context) {
  await stopServer(context, "configured")
}

async function runStaticGates(context) {
  for (const [args, kind, name] of [
    [["typecheck"], "typecheck", "typecheck"],
    [["lint"], "lint", "lint"],
    [["build"], "build", "build"],
  ]) {
    await assertCommand(args, kind, `${context.outputDir}/${name}.json`)
  }
  await assertNextTypeStability()
  const after3002 = await capturePort3002()
  if (after3002 !== context.before3002) throw new Error("Port 3002 listener changed")
}

async function assertCommand(args, envKind, outputPath) {
  const result = await runCorepackPnpm(args, { envKind, outputPath })
  if (result.exitCode !== 0) throw new Error(`corepack pnpm ${args.join(" ")} failed`)
}

async function assertNode(args, options) {
  const result = await runNode(args, options)
  if (result.exitCode !== 0) throw new Error(`node ${args.join(" ")} failed`)
}

async function stopServer(context, key) {
  const server = context[key]
  if (!server) return
  const stop = await server.stop()
  const child = context.children.find((candidate) => candidate.pid === server.ownedPid)
  if (child) child.stopped = true
  context[key] = null
  await writeRedactedOutput(`${context.outputDir}/next-${key}-stop.json`, { key, stop })
}

async function cleanup(context) {
  await stopServer(context, "unconfigured")
  await stopServer(context, "configured")
  if (context.qaProvision) await context.qaProvision.cleanup()
  await runStop().catch(() => {})
  await assertCommand(
    ["supabase:assert-stopped"],
    "supabase-command",
    `${context.outputDir}/assert-stopped.json`,
  )
}

function e2eControls(baseUrl) {
  const controls = { baseUrl }
  const forceLockTimeout = process.env.SPOLINK_E2E_FORCE_LOCK_TIMEOUT
  if (typeof forceLockTimeout === "string" && forceLockTimeout) {
    controls.SPOLINK_E2E_FORCE_LOCK_TIMEOUT = forceLockTimeout
  }
  return controls
}

async function waitForRelease(metadataPath, seconds) {
  const metadata = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(metadataPath, "utf8")),
  )
  const deadline = Date.now() + seconds * 1000
  while (Date.now() <= deadline) {
    if (await isReleased(metadata.releasePath)) return
    await delay(250)
  }
  throw new Error("QA hold timed out after 120 seconds")
}

function installSignalHandlers(context) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, async () => {
      await cleanup(context)
      process.exit(signal === "SIGINT" ? 130 : 143)
    })
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
