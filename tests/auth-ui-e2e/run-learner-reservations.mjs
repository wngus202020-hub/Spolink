#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  createLearnerReservationEvidenceWorkspace,
  publishLearnerReservationEvidence,
} from "./learner-reservations-evidence.mjs"
import { assertBrowserDiagnosticsReceipt } from "./learner-reservations-evidence-validation.mjs"
import { collectLearnerReservationSourceHashes } from "./learner-reservations-source-files.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const reservationSpec = "tests/auth-ui-e2e/learner-reservations.spec.ts"
const projects = ["mobile-chromium", "tablet-chromium", "desktop-chromium"]
const viewportWidths = [390, 768, 1280]

async function main() {
  const [outputPath = path.join(".omo/evidence", "learner-reservations-focused-summary.json")] =
    process.argv.slice(2)
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: false,
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  const workspace = await createLearnerReservationEvidenceWorkspace()
  let rawOutputRemoved = false
  try {
    const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
    if (!visualQaDir) throw new Error("SPOLINK_VISUAL_QA_DIR is required.")
    const summary = await withConfiguredAuthMode(
      { enableConfirmations: false },
      async ({ baseUrl, status }) => {
        const result = await runBuffered(
          "corepack",
          [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config=playwright.auth.config.ts",
            reservationSpec,
            "--project=mobile-chromium",
            "--project=tablet-chromium",
            "--project=desktop-chromium",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              SPOLINK_AUTH_E2E_STATUS_JSON: JSON.stringify({
                API_URL: status.apiUrl,
                DB_URL: status.dbUrl,
                PUBLISHABLE_KEY: status.anonKey,
                SECRET_KEY: status.serviceRoleKey,
              }),
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
              SPOLINK_TASK6_VISUAL_QA_DIR: workspace.stagedScreenshotsDir,
            }),
          },
        )
        if (result.exitCode !== 0) {
          console.error(redactDiagnostic(`${result.stdout}\n${result.stderr}`))
        }
        const browserReceipts =
          result.exitCode === 0 ? await collectBrowserReceipts(rawOutput.dir) : []
        const screenshots =
          result.exitCode === 0
            ? await collectScreenshotReceipts(workspace.stagedScreenshotsDir)
            : []
        return {
          browserReceipts,
          exitCode: result.exitCode,
          mode: "confirmation-off",
          projects,
          redaction: "identifiers-and-secrets-omitted",
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          screenshots,
          signal: result.signal,
          specs: [reservationSpec],
        }
      },
    )
    const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
    await rawOutput.cleanup()
    rawOutputRemoved = !rawOutput.retained
    const publishedSummary = {
      ...summary,
      rawOutput: { removed: rawOutputRemoved, retained: rawOutput.retained },
      runId: workspace.runId,
      schemaVersion: 2,
      sourceHashes: await collectLearnerReservationSourceHashes(),
      verdict,
    }
    if (verdict !== "APPROVE") {
      process.exitCode = 1
      return
    }
    await writeJsonMode600(workspace.stagedSummaryPath, publishedSummary)
    await publishLearnerReservationEvidence({
      outputPath,
      stagedScreenshotsDir: workspace.stagedScreenshotsDir,
      stagedSummaryPath: workspace.stagedSummaryPath,
      visualDir: visualQaDir,
    })
  } finally {
    if (!rawOutputRemoved) {
      const cleanup = await rawOutput.cleanup()
      if (cleanup) console.log(JSON.stringify({ playwrightOutputCleanup: "removed" }))
    }
    await workspace.cleanup()
  }
}

async function collectBrowserReceipts(directory) {
  const receipts = []
  for (const project of projects) {
    const diagnosis = JSON.parse(
      await readFile(path.join(directory, `task-6-browser-${project}.json`), "utf8"),
    )
    const phasesAreComplete =
      Array.isArray(diagnosis.phases) &&
      diagnosis.phases.length === 9 &&
      diagnosis.phases.every(
        (phase) =>
          typeof phase?.name === "string" &&
          phase.status === "passed" &&
          Number.isSafeInteger(phase.durationMs),
      )
    const download = diagnosis.download
    const downloadIsValid =
      typeof download?.bytes === "number" &&
      download.bytes > 0 &&
      typeof download.sha256 === "string" &&
      /^[0-9a-f]{64}$/u.test(download.sha256)
    assertBrowserDiagnosticsReceipt(diagnosis.browserDiagnostics)
    if (
      diagnosis.event !== "task6-browser-diagnosis" ||
      diagnosis.project !== project ||
      diagnosis.cleanup !== "completed" ||
      diagnosis.forbiddenRequestCount !== 0 ||
      diagnosis.inflightRequestCount !== 0 ||
      "inflightPath" in diagnosis ||
      "lastFailedPath" in diagnosis ||
      !phasesAreComplete ||
      !downloadIsValid ||
      !Array.isArray(diagnosis.screenshots) ||
      diagnosis.screenshots.length !== 2
    ) {
      throw new Error(`Invalid task 6 browser diagnosis: ${project}`)
    }
    receipts.push({
      browserDiagnostics: diagnosis.browserDiagnostics,
      cleanup: diagnosis.cleanup,
      download: { bytes: download.bytes, sha256: download.sha256 },
      forbiddenRequestCount: diagnosis.forbiddenRequestCount,
      phases: diagnosis.phases.map((phase) => ({ name: phase.name, status: phase.status })),
      project,
      screenshots: diagnosis.screenshots.map((screenshot) => ({
        height: screenshot.height,
        name: screenshot.name,
        sha256: screenshot.sha256,
        state: screenshot.state,
        width: screenshot.width,
      })),
    })
  }
  return receipts
}

export async function collectScreenshotReceipts(directory) {
  const receipts = []
  for (const width of viewportWidths) {
    for (const state of ["success", "recovery"]) {
      const name = `completion-${state}-${width}.png`
      const filePath = path.join(directory, name)
      const bytes = await readFile(filePath)
      if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error(`Invalid completion screenshot: ${name}`)
      }
      const expectedHeight = width === 390 ? 844 : 900
      if (bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== expectedHeight) {
        throw new Error(`Unexpected completion screenshot dimensions: ${name}`)
      }
      receipts.push({
        bytes: bytes.byteLength,
        height: expectedHeight,
        name,
        sha256: sha256(bytes),
        width,
      })
    }
  }
  return receipts
}

function redactDiagnostic(value) {
  return value
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
      "[REDACTED_ID]",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[REDACTED_EMAIL]")
    .replace(/(?:postgres(?:ql)?):\/\/[^\s]+/giu, "[REDACTED_DB_URL]")
    .replace(/(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/gu, "[REDACTED_TOKEN]")
    .replace(/(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+)/gu, "[REDACTED_KEY]")
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
