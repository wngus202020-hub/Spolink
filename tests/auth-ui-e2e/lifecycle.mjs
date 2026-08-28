import { liveHttpApiTestFiles } from "../api-contract-inventory.mjs"
import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { redactText } from "../supabase-e2e/task8/process.mjs"
import { assertNoExternalTestBaseUrl, createAuthSupabaseWorkspace } from "./config-mode.mjs"
import {
  createLifecycleControl,
  injectAuthFailure,
  runRequired,
  startNextChild,
  waitForConfiguredState,
} from "./lifecycle-child.mjs"
import { cleanupApiLifecycle } from "./lifecycle-cleanup.mjs"
import { buildApiTestEnv, createLifecycleContext, trackOwnedPid } from "./lifecycle-core.mjs"
import { reserveLoopbackPort } from "./ports.mjs"
import { runBuffered } from "./process.mjs"

export { describeCleanupFailure } from "./lifecycle-cleanup.mjs"
export {
  buildApiTestEnv,
  classifyMypageDocumentDiagnosis,
  createRunManifest,
  resolveCleanupReceiptPath,
} from "./lifecycle-core.mjs"

export async function runApiTestLifecycle({ repoRoot = process.cwd() } = {}) {
  assertNoExternalTestBaseUrl()
  const reservation = await reserveLoopbackPort()
  const context = await createLifecycleContext(reservation, { mode: "api" })
  installSignals(context)
  let failure = null
  try {
    await runRequired(context, "corepack", ["pnpm", "supabase:start"], repoRoot)
    context.supabaseOwned = true
    await runRequired(context, "corepack", ["pnpm", "supabase:reset"], repoRoot)
    const status = await readGuardedLocalStatus({ repoRoot })
    await reservation.release()
    context.released = true
    const next = await startNextChild(context, status, false)
    context.nextChild = next.child
    context.nextOutputCapture = next.outputCapture
    trackOwnedPid(context, context.nextChild.pid)
    await waitForConfiguredState(reservation.baseUrl)
    const testEnv = {
      ...buildApiTestEnv(process.env, reservation.baseUrl, status),
      ...(process.env.SPOLINK_PROFILE_API_INJECT_FAILURE
        ? { SPOLINK_PROFILE_API_INJECT_FAILURE: process.env.SPOLINK_PROFILE_API_INJECT_FAILURE }
        : {}),
    }
    const result = await runBuffered("corepack", ["pnpm", "test:api:contracts"], {
      cwd: repoRoot,
      env: testEnv,
    })
    if (result.exitCode !== 0) {
      throw new Error(
        `corepack pnpm test:api:contracts failed\nstdout:\n${redactText(result.stdout)}\nstderr:\n${redactText(result.stderr)}`,
      )
    }
    const fastContracts = summarizeNodeTestRun(result.stdout)
    if (
      fastContracts.testCount === 0 ||
      fastContracts.passCount !== fastContracts.testCount ||
      fastContracts.failCount !== 0 ||
      fastContracts.skippedCount !== 0
    ) {
      throw new Error("fast API contracts returned misleading success output")
    }
    const liveHttpResult = await runBuffered(
      process.execPath,
      ["--test", "--test-concurrency=1", ...liveHttpApiTestFiles],
      { cwd: repoRoot, env: testEnv },
    )
    if (liveHttpResult.exitCode !== 0) {
      throw new Error(
        `live HTTP API tests failed\nstdout:\n${redactText(liveHttpResult.stdout)}\nstderr:\n${redactText(liveHttpResult.stderr)}`,
      )
    }
    const liveHttpApi = summarizeNodeTestRun(liveHttpResult.stdout)
    if (
      liveHttpApi.testCount !== 17 ||
      liveHttpApi.passCount !== liveHttpApi.testCount ||
      liveHttpApi.failCount !== 0 ||
      liveHttpApi.skippedCount !== 0
    ) {
      throw new Error("live HTTP API tests returned misleading success output")
    }
    const liveResult = await runBuffered(
      process.execPath,
      ["--test", "--test-concurrency=1", "tests/auth-ui-e2e/profile-api.test.mjs"],
      { cwd: repoRoot, env: testEnv },
    )
    const liveProfileApi = summarizeLiveProfileApi(liveResult.stdout)
    if (liveResult.exitCode !== 0)
      throw new Error(
        `live profile API test failed\n${JSON.stringify({ cleanup: liveProfileApi.cleanup })}\nstdout:\n${redactText(liveResult.stdout)}\nstderr:\n${redactText(liveResult.stderr)}`,
      )
    if (!liveProfileApi.executed || liveProfileApi.testCount !== 1 || !liveProfileApi.scenario) {
      throw new Error("live profile API test returned misleading success output")
    }
    return {
      baseUrl: reservation.baseUrl,
      exitCode: liveResult.exitCode,
      fastContracts,
      liveHttpApi,
      liveProfileApi,
      port: reservation.port,
    }
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await cleanupOnce(context, repoRoot, failure)
    } finally {
      uninstallSignals(context)
    }
  }
}

function summarizeNodeTestRun(stdout) {
  const readCount = (label) =>
    Number(stdout.match(new RegExp(`(?:#|ℹ) ${label} (\\d+)`, "u"))?.[1] ?? 0)
  return {
    failCount: readCount("fail"),
    passCount: readCount("pass"),
    skippedCount: readCount("skipped"),
    testCount: readCount("tests"),
  }
}

function summarizeLiveProfileApi(stdout) {
  const title = "live profile lifecycle proves canonical persistence, ownership, and cleanup"
  return {
    cleanup: readStructuredEvent(stdout, "profile-api-live-cleanup-summary")?.cleanup ?? null,
    executed: stdout.includes(title),
    scenario: readStructuredEvent(stdout, "profile-api-live-summary"),
    testCount: Number(stdout.match(/(?:#|ℹ) tests (\d+)/u)?.[1] ?? 0),
    title,
  }
}

function readStructuredEvent(stdout, event) {
  for (const line of stdout.split(/\r?\n/u)) {
    const jsonStart = line.indexOf("{")
    if (jsonStart === -1) continue
    try {
      const value = JSON.parse(line.slice(jsonStart))
      if (value?.event === event) return value
    } catch {
      // Ignore non-JSON TAP lines while locating the exact structured event.
    }
  }
  return null
}

export async function withConfiguredAuthMode(options, callback) {
  assertNoExternalTestBaseUrl()
  const reservation = await reserveLoopbackPort()
  const repoRoot = options.repoRoot ?? process.cwd()
  const context = await createLifecycleContext(reservation, {
    ...options,
    mode: options.enableConfirmations ? "confirmation-on" : "confirmation-off",
  })
  installSignals(context, repoRoot)
  let failure = null
  try {
    if (options.configPath) throw new Error("Repository auth config overrides are not supported")
    const workspace = await createAuthSupabaseWorkspace({
      baseUrl: reservation.baseUrl,
      enableConfirmations: options.enableConfirmations,
      repoRoot,
    })
    context.authWorkspace = workspace
    context.manifest.configSnapshotHash = workspace.configSha256
    injectAuthFailure("after-config")
    await runRequired(context, "corepack", ["pnpm", "supabase:start"], workspace.root)
    context.supabaseOwned = true
    await workspace.assertRepositoryConfigUnchanged()
    await runRequired(context, "corepack", ["pnpm", "supabase:reset"], workspace.root)
    await workspace.assertRepositoryConfigUnchanged()
    const status = await readGuardedLocalStatus({ repoRoot: workspace.root })
    await reservation.release()
    context.released = true
    const next = await startNextChild(
      context,
      status,
      options.enableCoachUiFixtures === true,
      options.enableAdminOperationsUiFixtures === true,
    )
    context.nextChild = next.child
    context.nextOutputCapture = next.outputCapture
    trackOwnedPid(context, context.nextChild.pid)
    await waitForConfiguredState(reservation.baseUrl)
    context.nextReady = true
    injectAuthFailure("after-next-ready")
    return await callback({
      baseUrl: reservation.baseUrl,
      lifecycle: createLifecycleControl(context, repoRoot),
      port: reservation.port,
      status,
    })
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await cleanupOnce(context, repoRoot, failure)
    } finally {
      uninstallSignals(context)
    }
  }
}

function cleanupOnce(context, repoRoot, failure) {
  if (!context.cleanupPromise) {
    context.cleanupPromise = cleanupApiLifecycle(context, repoRoot, failure)
  }
  return context.cleanupPromise
}

function installSignals(context, repoRoot = process.cwd()) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = async () => {
      if (!context.signalExitPromise) {
        context.shuttingDown = true
        context.signalExitPromise = (async () => {
          try {
            await withDeadline(cleanupOnce(context, repoRoot, new Error(signal)), 30_000)
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error))
          }
          process.exit(signal === "SIGINT" ? 130 : 143)
        })()
      }
      await context.signalExitPromise
    }
    context.signalHandlers.push({ handler, signal })
    process.on(signal, handler)
  }
}

function uninstallSignals(context) {
  for (const { handler, signal } of context.signalHandlers) {
    process.off(signal, handler)
  }
  context.signalHandlers = []
}

async function withDeadline(promise, ms) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Auth lifecycle signal cleanup exceeded ${ms}ms`)),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}
