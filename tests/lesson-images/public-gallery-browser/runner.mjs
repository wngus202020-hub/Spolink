import { mkdir } from "node:fs/promises"
import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import postgres from "postgres"

import { readGuardedLocalStatus } from "../../supabase-e2e/local-status.mjs"
import {
  ACTION_TIMEOUT_MS,
  createProgressReporter,
  installFatalHandlers,
  startOwnedNextServer,
  withTimeout,
} from "../public-gallery-browser-qa-runtime.mjs"
import { attachBrowserTelemetry, createRuntimeReceipt } from "./browser-telemetry.mjs"
import { cleanupPublicGallery } from "./cleanup.mjs"
import { createRunConfig } from "./config.mjs"
import {
  finalizeTraceEvidence,
  publishFailureArtifact,
  publishSuccessArtifacts,
} from "./evidence.mjs"
import { createFixtureState, createGalleryFixtures } from "./fixtures.mjs"
import { runPublicGalleryScenarios } from "./scenarios.mjs"

export async function runPublicGalleryBrowserQa() {
  const config = createRunConfig()
  const status = await readGuardedLocalStatus()
  const progressEntries = []
  const context = {
    config,
    fixture: createFixtureState(),
    progress: createProgressReporter(progressEntries),
    report: {
      progress: progressEntries,
      runIdHash: config.runIdHash,
      runtime: createRuntimeReceipt(),
      scenarios: {},
      status: "running",
      viewports: [],
    },
    resources: { browser: null, ownedServer: null },
    service: createClient(status.apiUrl, status.serviceRoleKey, {
      auth: { persistSession: false },
    }),
    sql: postgres(status.dbUrl, { max: 1 }),
    status,
  }
  const scenarioAbort = new AbortController()
  let fatalReason = null
  let fatalReject
  const fatalPromise = new Promise((_, reject) => {
    fatalReject = reject
  })
  const removeFatalHandlers = installFatalHandlers((error, source) => {
    if (fatalReason) return
    fatalReason = { error, source }
    scenarioAbort.abort(error)
    context.progress("fatal-signal", { source })
    fatalReject(error)
  })

  await mkdir(config.stagingDir, { mode: 0o700, recursive: true })
  context.progress("runner-started")
  const scenarioTask = runScenario(context, scenarioAbort.signal)
  let cleanupReceipt
  let scenarioError = null
  try {
    await Promise.race([
      withTimeout("public gallery browser QA", config.runTimeoutMs, (timeoutSignal) => {
        timeoutSignal.addEventListener("abort", () => scenarioAbort.abort(), { once: true })
        return scenarioTask
      }),
      fatalPromise,
    ])
    context.report.status = "scenario-passed"
  } catch (error) {
    scenarioError = error
    context.report.status = "failed"
    context.report.error = safeError(error)
  } finally {
    scenarioAbort.abort(scenarioError ?? fatalReason?.error)
    await withTimeout("scenario shutdown", ACTION_TIMEOUT_MS, () =>
      scenarioTask.catch(() => undefined),
    ).catch((error) => {
      scenarioError ??= error
      context.report.scenarioShutdownError = safeError(error)
    })
    try {
      cleanupReceipt = await withTimeout(
        "public gallery cleanup",
        config.cleanupTimeoutMs,
        (cleanupSignal) => cleanupPublicGallery(context, cleanupSignal),
        { returnActionAfterAbort: true, waitForActionAfterAbort: true },
      )
      if (cleanupReceipt.timedOut) {
        const error = new Error(
          `public gallery cleanup timed out after ${config.cleanupTimeoutMs}ms`,
        )
        scenarioError ??= error
        context.report.status = "failed"
        context.report.cleanupError = error.message
      }
    } catch (error) {
      scenarioError ??= error
      context.report.status = "failed"
      context.report.cleanupError = safeError(error)
    }
  }

  scenarioError ??= fatalReason?.error ?? null
  removeFatalHandlers()
  if (!scenarioError && cleanupReceipt?.allZero === true) {
    context.report.status = "passed"
    await publishSuccessArtifacts(context, cleanupReceipt)
    return 0
  }
  await publishFailureArtifact(context, cleanupReceipt)
  return fatalReason?.source?.startsWith("SIG") ? 143 : 1
}

async function runScenario(context, signal) {
  await createGalleryFixtures({
    fixture: context.fixture,
    runId: context.config.runId,
    service: context.service,
    sql: context.sql,
  })
  signal.throwIfAborted()
  context.progress("fixtures-created")
  if (process.env.PUBLIC_GALLERY_INJECT_FAILURE === "after-fixtures") {
    throw new Error("Injected gallery assertion failure after fixtures")
  }
  context.resources.ownedServer = await startOwnedNextServer({
    onOwned: (server) => {
      context.resources.ownedServer = server
    },
    port: 3268,
    progress: context.progress,
    repoRoot: context.config.repoRoot,
    signal,
    status: context.status,
  })
  signal.throwIfAborted()
  if (process.env.PUBLIC_GALLERY_INJECT_HANG === "after-server") await waitForAbort(signal)
  context.resources.browser = await withTimeout("Chromium launch", ACTION_TIMEOUT_MS, () =>
    chromium.launch({ headless: true }),
  )
  signal.throwIfAborted()
  const browserContext = await context.resources.browser.newContext({
    baseURL: context.resources.ownedServer.baseUrl,
    viewport: { height: 800, width: 1280 },
  })
  browserContext.setDefaultTimeout(ACTION_TIMEOUT_MS)
  browserContext.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS)
  await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
  const page = await browserContext.newPage()
  attachBrowserTelemetry(page, context.report.runtime)
  await runPublicGalleryScenarios(context, page, signal)
  await finalizeTraceEvidence(context, browserContext)
  await browserContext.close()
  context.progress("scenario-complete")
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error)
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  })
}
