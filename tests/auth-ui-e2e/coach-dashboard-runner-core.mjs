import path from "node:path"
import {
  resolveCoachDashboardRunShape,
  resolveCoachDashboardRunTarget,
} from "./coach-dashboard-run-target.mjs"
import { collectBasicCoachDashboardVisuals } from "./coach-dashboard-runner-visuals.mjs"
import {
  collectCoachDashboardVisualEvidence,
  prepareCoachDashboardVisualDirectory,
  readCoachDashboardVisualSourceBinding,
  visualScreenshotNames,
} from "./coach-dashboard-visual-artifacts.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/coach-dashboard.spec.ts"
const kstOffsetMilliseconds = 9 * 60 * 60 * 1_000

export function defaultCoachDashboardEpoch(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("A valid runner clock is required")
  }
  const kstDate = new Date(now.getTime() + kstOffsetMilliseconds).toISOString().slice(0, 10)
  return `${kstDate}T03:00:00.000Z`
}

export async function executeCoachDashboardRun(options) {
  const runTarget = resolveCoachDashboardRunTarget(options.grep)
  const runShape = resolveCoachDashboardRunShape(runTarget)
  const visualRun = runTarget.variant === "visual-responsive"
  const dependencies = {
    collectBasicVisuals: collectBasicCoachDashboardVisuals,
    collectVisuals: collectCoachDashboardVisualEvidence,
    prepareRawOutput: () => prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null }),
    prepareVisualDir: prepareCoachDashboardVisualDirectory,
    readSourceBinding: readCoachDashboardVisualSourceBinding,
    runPlaywright: runPlaywrightProcess,
    withLifecycle: withConfiguredAuthMode,
    ...options.dependencies,
  }
  validateEpoch(options.epoch)
  const injectedRun = validateFailureOptions(options)
  const sourceBinding = visualRun ? await dependencies.readSourceBinding() : null
  if (visualRun) await dependencies.prepareVisualDir(options.visualDir)
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
            ...runShape.projects.map((project) => `--project=${project}`),
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
          const fixtureEvents = readFixtureEvents(result.stdout)
          const fixtureSummary = summarizeFixtureEvents(fixtureEvents)
          const visualChecks = visualRun ? readVisualEvents(result.stdout) : null
          return {
            exitCode: result.exitCode,
            failureClass: result.exitCode === 0 ? null : "playwright",
            failureHash:
              result.exitCode === 0 ? null : sha256(`${result.stdout}\n${result.stderr}`),
            fixtureCleanup: fixtureSummary?.cleanup ?? null,
            fixtureRuns: fixtureEvents.length,
            scenario: fixtureSummary?.scenario ?? null,
            signal: result.signal,
            outputHash: sha256(`${result.stdout}${result.stderr}`),
            visualChecks,
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

  const visuals = visualRun
    ? await dependencies.collectVisuals(options.visualDir, {
        expectedNames: visualScreenshotNames,
        freshnessFloorMs: sourceBinding?.latestMtimeMs,
      })
    : await dependencies.collectBasicVisuals(options.visualDir, runShape.expectedScreenshots)
  const fixtureCleanup = lifecycleSummary?.fixtureCleanup ?? null
  const approved =
    lifecycleSummary?.exitCode === 0 &&
    lifecycleErrorHash === null &&
    fixtureCleanup?.coachProfilesRemaining === 0 &&
    fixtureCleanup?.graphRowsRemaining === 0 &&
    fixtureCleanup?.profilesRemaining === 0 &&
    fixtureCleanup?.usersRemaining === 0 &&
    lifecycleSummary?.fixtureRuns === runShape.expectedFixtureRuns &&
    (!visualRun || lifecycleSummary?.visualChecks?.verdict === "APPROVE") &&
    visuals.verdict === "APPROVE"
  return {
    schemaVersion: 1,
    epochHash: sha256(options.epoch),
    exitCode: lifecycleSummary?.exitCode ?? 1,
    failureClass: lifecycleSummary?.failureClass ?? (lifecycleErrorHash ? "lifecycle" : null),
    failureHash: lifecycleSummary?.failureHash ?? lifecycleErrorHash,
    fixtureCleanup,
    fixtureRuns: lifecycleSummary?.fixtureRuns ?? 0,
    grepApplied: Boolean(options.grep),
    lifecycleCleanupReceipt: path.basename(options.outputPath.replace(/\.json$/u, ".cleanup.json")),
    outputHash: lifecycleSummary?.outputHash ?? null,
    rawOutputCleanupHash,
    scenario: lifecycleSummary?.scenario ?? (options.failurePoint ? "injected-failure" : "unknown"),
    signal: lifecycleSummary?.signal ?? null,
    sourceBinding,
    specs: [spec],
    verdict: approved ? "APPROVE" : "REJECT",
    visualChecks: lifecycleSummary?.visualChecks ?? null,
    visuals,
  }
}

async function runPlaywrightProcess({ args, env }) {
  return runBuffered("corepack", args, { env })
}

function readFixtureEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/u)) {
    const marker = "COACH_DASHBOARD_FIXTURE "
    const start = line.indexOf(marker)
    if (start < 0) continue
    const value = JSON.parse(line.slice(start + marker.length))
    if (
      typeof value?.scenario === "string" &&
      Number.isInteger(value?.cleanup?.coachProfilesRemaining) &&
      Number.isInteger(value?.cleanup?.graphRowsRemaining) &&
      Number.isInteger(value?.cleanup?.profilesRemaining) &&
      Number.isInteger(value?.cleanup?.usersRemaining)
    ) {
      events.push(value)
    }
  }
  return events
}

function summarizeFixtureEvents(events) {
  if (events.length === 0) return null
  const keys = [
    "coachProfilesRemaining",
    "graphRowsRemaining",
    "profilesRemaining",
    "usersRemaining",
  ]
  return {
    cleanup: Object.fromEntries(
      keys.map((key) => [key, Math.max(...events.map((event) => event.cleanup[key]))]),
    ),
    scenario: events.at(-1)?.scenario ?? null,
  }
}

function readVisualEvents(stdout) {
  const projects = []
  for (const line of stdout.split(/\r?\n/u)) {
    const marker = "COACH_DASHBOARD_VISUAL "
    const start = line.indexOf(marker)
    if (start < 0) continue
    const value = JSON.parse(line.slice(start + marker.length))
    if (
      ["desktop", "mobile", "tablet"].includes(value?.project) &&
      Array.isArray(value?.captures) &&
      value?.verdict === "APPROVE"
    ) {
      projects.push(value)
    }
  }
  const projectNames = projects.map((project) => project.project).sort()
  const captureCount = projects.reduce((count, project) => count + project.captures.length, 0)
  return {
    captureCount,
    projects,
    verdict:
      JSON.stringify(projectNames) === JSON.stringify(["desktop", "mobile", "tablet"]) &&
      captureCount === 14
        ? "APPROVE"
        : "REJECT",
  }
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
