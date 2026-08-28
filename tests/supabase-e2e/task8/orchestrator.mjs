import { rename } from "node:fs/promises"
import path from "node:path"
import { runStop } from "../../../scripts/supabase-local.mjs"
import { resolveSupabaseOutputDir } from "../../auth-ui-e2e/evidence-paths.mjs"
import { resolveTask3AggregateEnvironment } from "../../high-priority-missing-services/task3-evidence.mjs"
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
import { waitForQaRelease } from "./orchestration-helpers.mjs"
import { redactText, runCorepackPnpm, runNode, writeRedactedOutput } from "./process.mjs"
import { assertQaState, removeQaSideEffects, withQaSql } from "./qa-db.mjs"
import { createQaFiles } from "./qa-files.mjs"
import { finalizeQaSuccess } from "./qa-proof.mjs"
import { releaseRecordedNextOwnership, restoreRecordedNextOwnership } from "./receipt-ownership.mjs"
import {
  configuredE2eTestFiles,
  coreNodeTestFiles,
  createE2eControls,
} from "./registered-tests.mjs"
import {
  cleanupSupabaseRuntime,
  createCleanupCoordinator,
  createSignalCleanupHandler,
  prepareSupabaseRuntime,
} from "./runtime-lifecycle.mjs"

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
    await stopServer(context, "configured")
    await runStaticGates(context)
  } catch (error) {
    caughtError = error
  } finally {
    try {
      await cleanup(context)
    } catch (firstCleanupError) {
      let cleanupError = firstCleanupError
      try {
        await cleanup(context)
      } catch (secondCleanupError) {
        cleanupError = aggregateErrors(firstCleanupError, secondCleanupError)
      }
      caughtError = aggregateErrors(caughtError, cleanupError)
      context.cleanupError = cleanupError
    }
    if (!caughtError) {
      try {
        context.qaSuccess = await finalizeQaSuccess(context.cleanupProofPath)
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
      cleanupCommand: context.cleanupCommand,
      cleanupProofPath: context.cleanupProofPath,
      qaSuccess: context.qaSuccess,
      summaryPath,
    })
  }
  if (caughtError) throw caughtError
}

function createContext() {
  const context = {
    before3002: null,
    children: [],
    cleanupError: null,
    cleanupCoordinator: null,
    configured: null,
    hold: assertQaHoldRequest({
      metadataPath: process.env.SPOLINK_E2E_QA_METADATA,
      seconds: process.env.SPOLINK_E2E_QA_HOLD_SECONDS,
    }),
    qaProvision: null,
    qaProvisionCleaned: false,
    qaSuccess: null,
    cleanupCommand: null,
    cleanupProofPath: null,
    recordedNext: [],
    status: null,
    supabaseRuntime: null,
    signalCleanupError: null,
    unconfigured: null,
    outputDir: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs",
  }
  context.cleanupCoordinator = createCleanupCoordinator(() => performCleanup(context))
  return context
}

async function setup(context) {
  const aggregateEnvironment = await resolveTask3AggregateEnvironment({
    attemptRoot: process.env.SPOLINK_TASK3_ATTEMPT_DIR,
    outputDir: process.env.SPOLINK_E2E_OUTPUT_DIR,
    repoRoot: process.cwd(),
  })
  context.outputDir = await resolveSupabaseOutputDir()
  if (context.outputDir !== aggregateEnvironment.outputDir)
    throw new Error("Resolved Supabase output does not match the Task 3 aggregate attempt")
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
  if (result.exitCode !== 0) {
    const diagnostics = redactText(
      `stdout tail:\n${result.stdout.slice(-4_000)}\nstderr tail:\n${result.stderr.slice(-4_000)}`,
    )
    throw new Error(
      `Unconfigured live test:api failed (exit ${result.exitCode}, signal ${result.signal ?? "none"})\n${diagnostics}`,
    )
  }
  await stopServer(context, "unconfigured")
}

async function runSupabaseCore(context) {
  context.supabaseRuntime = await prepareSupabaseRuntime({
    publishOwnedRuntime: (runtime) => {
      context.supabaseRuntime = runtime
    },
    readStatus: readGuardedLocalStatus,
    reset: () =>
      assertCommand(
        ["supabase:reset"],
        "supabase-command",
        `${context.outputDir}/supabase-reset-1.json`,
      ),
    start: () =>
      assertCommand(
        ["supabase:start"],
        "supabase-command",
        `${context.outputDir}/supabase-start.json`,
      ),
  })
  context.status = context.supabaseRuntime.status
  await writeRedactedOutput(`${context.outputDir}/supabase-runtime-mode.json`, {
    bindingSha256: context.supabaseRuntime.bindingSha256,
    mode: context.supabaseRuntime.mode,
  })
  await restoreRecordedNextOwnership(context.recordedNext)
  await assertNode(["tests/supabase-e2e/provision.mjs", "--pg-tap"], {
    controls: { baseUrl: "http://127.0.0.1:1" },
    outputPath: `${context.outputDir}/provision-pg-tap.json`,
  })
  await assertCommand(["supabase:test:db"], "supabase-command", `${context.outputDir}/pg-tap.json`)
  await resetOwnedRuntime(context, "supabase-reset-2")
  await assertNode(["--test", "tests/supabase-e2e/auth-rls.test.mjs"], {
    controls: { baseUrl: "http://127.0.0.1:1" },
    outputPath: `${context.outputDir}/auth-rls.json`,
  })
  for (const file of coreNodeTestFiles) {
    await assertNode([file], {
      controls: { baseUrl: "http://127.0.0.1:1" },
      outputPath: `${context.outputDir}/${path.basename(file)}.json`,
    })
  }
  context.status = await readGuardedLocalStatus()
}

async function runConfiguredE2e(context) {
  await resetOwnedRuntime(context, "supabase-reset-3")
  await ensureAuthGatewayReady()
  context.status = await readGuardedLocalStatus()
  context.configured = await startNextServer({ mode: "configured", status: context.status })
  context.children.push({ pid: context.configured.ownedPid, stopped: false })
  assertSingleOwnedNext(context.children)
  if (process.env.SPOLINK_E2E_INJECT_FAILURE === "after-next-ready") {
    throw new Error("Injected Todo8 failure after configured Next readiness")
  }
  for (const file of configuredE2eTestFiles) {
    const result = await runNode(["--test", file], {
      controls: createE2eControls(context.configured.baseUrl),
      outputPath: `${context.outputDir}/${path.basename(file)}.json`,
    })
    if (result.exitCode !== 0) throw new Error(`${file} failed`)
  }
}

async function runQa(context) {
  await resetOwnedRuntime(context, "supabase-reset-qa")
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
    await waitForQaRelease(context.hold.metadataPath, context.hold.seconds)
  } else {
    await runInternalQa(context)
  }
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
  if (server.ownedPid && server.port) {
    context.recordedNext.push({ pid: server.ownedPid, port: server.port })
  }
  context[key] = null
  await writeRedactedOutput(`${context.outputDir}/next-${key}-stop.json`, { key, stop })
}

async function cleanup(context) {
  return context.cleanupCoordinator.run()
}

async function performCleanup(context) {
  const errors = []
  await collectCleanupError(errors, () => stopServer(context, "unconfigured"))
  await collectCleanupError(errors, () => stopServer(context, "configured"))
  if (context.qaProvision && !context.qaProvisionCleaned) {
    await collectCleanupError(errors, async () => {
      await context.qaProvision.cleanup()
      context.qaProvisionCleaned = true
    })
  }
  if (context.recordedNext.length > 0) {
    await collectCleanupError(errors, async () => {
      await releaseRecordedNextOwnership(context.recordedNext)
      context.recordedNext = []
    })
  }
  await collectCleanupError(errors, () => cleanupSupabase(context))
  if (errors.length > 0) throw new AggregateError(errors, "Todo8 cleanup failed")
}

async function cleanupSupabase(context) {
  if (!context.supabaseRuntime || context.supabaseRuntime.cleanup.state === "completed") return
  const finalProofPath =
    context.supabaseRuntime.mode === "owned"
      ? `${context.outputDir}/assert-stopped.json`
      : `${context.outputDir}/supabase-preserved.json`
  const pendingProofPath = `${context.outputDir}/assert-stopped.pending.json`
  const result = await cleanupSupabaseRuntime(context.supabaseRuntime, {
    assertStopped: () =>
      assertCommand(["supabase:assert-stopped"], "supabase-command", pendingProofPath),
    commitOwnedProof: () => rename(pendingProofPath, finalProofPath),
    readStatus: readGuardedLocalStatus,
    stop: runStop,
    writePreservedReceipt: (receipt) =>
      writeRedactedOutput(finalProofPath, {
        ...receipt,
        command: "guarded status before and after full Supabase E2E",
        mode: "reused",
      }),
  })
  context.cleanupProofPath = finalProofPath
  context.cleanupCommand =
    result.kind === "stopped"
      ? "corepack pnpm supabase:stop && corepack pnpm supabase:assert-stopped"
      : "guarded status before and after; reused runtime preserved without reset or stop"
}

async function collectCleanupError(errors, operation) {
  try {
    await operation()
  } catch (error) {
    errors.push(error)
  }
}

function aggregateErrors(primary, cleanupError) {
  return primary
    ? new AggregateError([primary, cleanupError], "Todo8 run and cleanup failed")
    : cleanupError
}

async function resetOwnedRuntime(context, outputName) {
  if (context.supabaseRuntime?.mode !== "owned") return
  await assertCommand(
    ["supabase:reset"],
    "supabase-command",
    `${context.outputDir}/${outputName}.json`,
  )
}

function installSignalHandlers(context) {
  const handleSignal = createSignalCleanupHandler({
    cleanup: () => cleanup(context),
    exit: (code) => process.exit(code),
    recordError: (error) => {
      context.signalCleanupError = aggregateErrors(context.signalCleanupError, error)
      process.exitCode = 1
    },
  })
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void handleSignal(signal)
    })
  }
}
