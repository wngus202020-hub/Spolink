#!/usr/bin/env node
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import {
  buildAdminDashboardSummary,
  publishAdminDashboardEvidence,
} from "./admin-dashboard-evidence.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { readPlaywrightErrorCount, readPlaywrightScenarios } from "./playwright-report-summary.mjs"
import { buildChildEnv, sha256 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/task-10-ui.spec.ts"
const outputPath = path.resolve(
  process.argv[2] ?? ".omo/evidence/high-priority-missing-services/task-10/ui.json",
)
const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false })
const dashboardWorkspace = path.join(rawOutput.dir, "admin-dashboard")
const dashboardEvidenceDir = path.resolve(".omo/evidence/admin-operations-dashboard/task-8")
let result
let lifecycleError = null
let dashboard = { verdict: "REJECT" }
try {
  result = await withConfiguredAuthMode(
    { enableAdminOperationsUiFixtures: true, enableConfirmations: false },
    async ({ baseUrl, lifecycle, status }) =>
      lifecycle.runBrowserChild(
        "corepack",
        [
          "pnpm",
          "exec",
          "playwright",
          "test",
          "--config=playwright.auth.config.ts",
          spec,
          "--project=desktop-chromium",
          "--project=mobile-chromium",
          "--project=tablet-chromium",
          "--reporter=json",
        ],
        {
          env: buildChildEnv(process.env, {
            NODE_ENV: "test",
            SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
            SPOLINK_AUTH_E2E_ANON_KEY: status.anonKey,
            SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
            SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
            SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status.serviceRoleKey,
            SPOLINK_ADMIN_DASHBOARD_EVIDENCE_DIR: dashboardWorkspace,
          }),
        },
      ),
  )
  dashboard = await readDashboardSummary(dashboardWorkspace)
  if (result.exitCode === 0 && dashboard.verdict === "APPROVE") {
    await publishAdminDashboardEvidence({
      destinationDir: dashboardEvidenceDir,
      summary: dashboard,
      workspaceDir: dashboardWorkspace,
    })
    await writeRedactedJson(
      path.join(dashboardEvidenceDir, "summary.json"),
      { ...dashboard, schemaVersion: 1 },
      [],
    )
  }
} catch (_error) {
  lifecycleError = "guarded-runtime-unavailable"
  result = { exitCode: 1, stdout: "", stderr: "" }
} finally {
  await rawOutput.cleanup()
}
const summary = {
  schemaVersion: 1,
  verdict: result.exitCode === 0 && dashboard.verdict === "APPROVE" ? "APPROVE" : "REJECT",
  spec,
  projects: ["desktop-chromium", "mobile-chromium", "tablet-chromium"],
  exitCode: result.exitCode,
  outputSha256: sha256(`${result.stdout}${result.stderr}`),
  reportErrorCount: readPlaywrightErrorCount(result.stdout),
  scenarios: readPlaywrightScenarios(result.stdout),
  lifecycleError,
  adminDashboard: dashboard,
  notes: [
    "Real favorites, reviews, trust-safety, notifications, admin, and coach flows are included through the authenticated Playwright suite.",
    "The route matrix runs in 390px, 768px, and 1280px projects and records overflow plus visible control overlap metrics.",
    ...(lifecycleError
      ? [
          "No authenticated run was recorded because the guarded runtime was not owned by this task.",
        ]
      : []),
  ],
}
await mkdir(path.dirname(outputPath), { mode: 0o700, recursive: true })
await writeRedactedJson(outputPath, summary, [])
console.log(JSON.stringify({ outputPath, verdict: summary.verdict }))
if (summary.verdict !== "APPROVE") process.exitCode = 1

async function readDashboardSummary(workspaceDir) {
  try {
    return await buildAdminDashboardSummary({ workspaceDir })
  } catch (error) {
    return {
      errorSha256: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}
