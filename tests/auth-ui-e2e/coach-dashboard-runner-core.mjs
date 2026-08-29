import { chmod, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/coach-dashboard.spec.ts"

export async function executeCoachDashboardRun(options) {
  const dependencies = {
    collectVisuals: collectVisualEvidence,
    prepareRawOutput: () => prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null }),
    runPlaywright: runPlaywrightProcess,
    withLifecycle: withConfiguredAuthMode,
    ...options.dependencies,
  }
  validateEpoch(options.epoch)
  const injectedRun = validateFailureOptions(options)
  const rawOutput = await dependencies.prepareRawOutput()
  let lifecycleErrorHash = null
  let lifecycleSummary = null
  let rawOutputCleanupHash = null
  try {
    try {
      lifecycleSummary = await dependencies.withLifecycle(
        {
          cleanupReceiptPath: options.outputPath.replace(/\.json$/u, ".cleanup.json"),
          enableCoachUiFixtures: true,
          enableConfirmations: false,
          evidencePaths: [options.outputPath],
          runId: `coach-dashboard-${sha256(options.epoch).slice(0, 12)}-${process.pid}`,
        },
        async ({ baseUrl, status }) => {
          const args = [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config=playwright.auth.config.ts",
            spec,
            "--project=desktop-chromium",
            "--workers",
            "1",
            ...(options.grep ? ["--grep", options.grep] : []),
          ]
          const env = buildChildEnv(process.env, {
            NODE_ENV: "test",
            SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
            SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
            SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
            SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status.serviceRoleKey,
            SPOLINK_COACH_DASHBOARD_EPOCH: options.epoch,
            SPOLINK_COACH_DASHBOARD_VISUAL_DIR: options.visualDir,
            ...(injectedRun
              ? {
                  SPOLINK_COACH_DASHBOARD_INJECT_FAILURE: "after-seed",
                  SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT: "1",
                }
              : {}),
          })
          const result = await dependencies.runPlaywright({ args, env })
          const fixtureEvent = readFixtureEvent(result.stdout)
          return {
            exitCode: result.exitCode,
            failureClass: result.exitCode === 0 ? null : "playwright",
            failureHash:
              result.exitCode === 0 ? null : sha256(`${result.stdout}\n${result.stderr}`),
            fixtureCleanup: fixtureEvent?.cleanup ?? null,
            scenario: fixtureEvent?.scenario ?? null,
            signal: result.signal,
            outputHash: sha256(`${result.stdout}${result.stderr}`),
          }
        },
      )
    } catch (error) {
      lifecycleErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }
  } finally {
    const cleanup = await rawOutput.cleanup()
    rawOutputCleanupHash = sha256(JSON.stringify(cleanup ?? { retained: false }))
  }

  const visuals = await dependencies.collectVisuals(options.visualDir)
  const fixtureCleanup = lifecycleSummary?.fixtureCleanup ?? null
  const approved =
    lifecycleSummary?.exitCode === 0 &&
    lifecycleErrorHash === null &&
    fixtureCleanup?.dbRowsRemaining === 0 &&
    fixtureCleanup?.usersRemaining === 0 &&
    visuals.verdict === "APPROVE"
  return {
    schemaVersion: 1,
    epochHash: sha256(options.epoch),
    exitCode: lifecycleSummary?.exitCode ?? 1,
    failureClass: lifecycleSummary?.failureClass ?? (lifecycleErrorHash ? "lifecycle" : null),
    failureHash: lifecycleSummary?.failureHash ?? lifecycleErrorHash,
    fixtureCleanup,
    grepApplied: Boolean(options.grep),
    lifecycleCleanupReceipt: path.basename(options.outputPath.replace(/\.json$/u, ".cleanup.json")),
    outputHash: lifecycleSummary?.outputHash ?? null,
    rawOutputCleanupHash,
    scenario: lifecycleSummary?.scenario ?? (options.failurePoint ? "injected-failure" : "unknown"),
    signal: lifecycleSummary?.signal ?? null,
    specs: [spec],
    verdict: approved ? "APPROVE" : "REJECT",
    visuals,
  }
}

async function runPlaywrightProcess({ args, env }) {
  return runBuffered("corepack", args, { env })
}

async function collectVisualEvidence(directory) {
  let names = []
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".png")).sort()
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  const files = []
  for (const name of names) {
    const filePath = path.join(directory, name)
    await chmod(filePath, 0o600)
    const metadata = await stat(filePath)
    if (!metadata.isFile() || metadata.size === 0) throw new Error("Invalid dashboard PNG")
    files.push({ bytes: metadata.size, name, sha256: sha256(await readFile(filePath)) })
  }
  return { files, verdict: files.length === 1 ? "APPROVE" : "REJECT" }
}

function readFixtureEvent(stdout) {
  for (const line of stdout.split(/\r?\n/u)) {
    const marker = "COACH_DASHBOARD_FIXTURE "
    const start = line.indexOf(marker)
    if (start < 0) continue
    const value = JSON.parse(line.slice(start + marker.length))
    if (
      typeof value?.scenario === "string" &&
      Number.isInteger(value?.cleanup?.dbRowsRemaining) &&
      Number.isInteger(value?.cleanup?.usersRemaining)
    ) {
      return value
    }
  }
  return null
}

function validateEpoch(epoch) {
  const value = new Date(epoch)
  if (!Number.isFinite(value.getTime()) || value.toISOString() !== epoch) {
    throw new Error("A canonical coach dashboard epoch is required")
  }
}

function validateFailureOptions(options) {
  if (!options.failurePoint) return false
  if (options.failurePoint !== "after-seed" || options.allowInjectedFailure !== true) {
    throw new Error("Coach dashboard injected failure is restricted to runner contracts")
  }
  return true
}
