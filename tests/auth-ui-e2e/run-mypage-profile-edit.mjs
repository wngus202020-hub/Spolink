#!/usr/bin/env node

import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { summarizePlaywrightReport } from "./mypage-profile-edit-runner-report.mjs"
import {
  expectedTitles,
  isApproved,
  profileEditSpec,
  projects,
  readLastRunVerdict,
  readRawOutputInventoryVerdict,
  retainedRawOutputLabel,
} from "./mypage-profile-edit-runner-summary.mjs"
import { readVisualEvidence } from "./mypage-profile-edit-runner-visual.mjs"
import {
  createProfileEditRunTarget,
  prepareProfileEditVisualWorkspace,
} from "./mypage-profile-edit-runner-visual-publication.mjs"
import {
  cleanupRunnerCreatedSupabaseCliTemp,
  snapshotSupabaseCliTemp,
} from "./mypage-profile-edit-runtime-cleanup.mjs"
import { writeProfileEditTerminalReceipt } from "./mypage-profile-edit-terminal-receipt.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

async function main() {
  const [requestedOutputPath] = process.argv.slice(2)
  const target = requestedOutputPath
    ? {
        outputPath: requestedOutputPath,
        visualDir:
          process.env["SPOLINK_VISUAL_QA_DIR"] ??
          path.join(path.dirname(requestedOutputPath), "visual"),
      }
    : await createProfileEditRunTarget()
  const { outputPath } = target
  const visualPreparation = await prepareVisualDirectory({
    outputPath,
    requestedDir: target.visualDir,
  })
  if (visualPreparation.verdict !== "APPROVE") {
    await writeRejectedVisualSummary(outputPath, visualPreparation.errorHash)
    process.exitCode = 1
    return
  }
  const visualWorkspace = visualPreparation.workspace
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  let runSummary = null
  let runErrorHash = null
  let cleanupHash = null
  let cleanupErrorHash = null
  const supabaseTempSnapshot = await snapshotSupabaseCliTemp()
  let supabaseTempCleanup = { verdict: "REJECT" }
  let supabaseTempCleanupErrorHash = null

  try {
    try {
      runSummary = await withConfiguredAuthMode(
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
              profileEditSpec,
              "--project=desktop-chromium",
              "--project=tablet-chromium",
              "--project=mobile-chromium",
              "--workers",
              "1",
              "--reporter=json",
            ],
            {
              env: buildChildEnv(process.env, {
                NODE_ENV: "test",
                SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
                SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
                SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
                SPOLINK_VISUAL_QA_DIR: visualWorkspace.captureDir,
              }),
            },
          )
          const report = summarizePlaywrightReport(result.stdout, { expectedTitles, projects })
          return {
            exitCode: result.exitCode,
            lastRun: await readLastRunVerdict(rawOutput.dir, { sha256 }),
            outputInventory: await readRawOutputInventoryVerdict(rawOutput.dir, { sha256 }),
            playwrightReport: report,
            rawOutputDirRetained: retainedRawOutputLabel(rawOutput),
            resultHash: sha256(`${result.stdout}${result.stderr}`),
            signal: result.signal,
            specs: [profileEditSpec],
            visual: await readVisualEvidence(visualWorkspace.captureDir, { sha256 }),
          }
        },
      )
    } catch (error) {
      runErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }
  } finally {
    try {
      const cleanup = await rawOutput.cleanup()
      cleanupHash = sha256(JSON.stringify(cleanup ?? { retained: rawOutput.retained }))
    } catch (error) {
      cleanupErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }
    try {
      supabaseTempCleanup = await cleanupRunnerCreatedSupabaseCliTemp(supabaseTempSnapshot)
    } catch (error) {
      supabaseTempCleanupErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    exitCode: runSummary?.exitCode ?? null,
    lastRun: runSummary?.lastRun ?? { verdict: "REJECT" },
    outputInventory: runSummary?.outputInventory ?? { verdict: "REJECT" },
    playwrightReport: runSummary?.playwrightReport ?? { verdict: "REJECT" },
    projects,
    rawOutputCleanupHash: cleanupHash,
    rawOutputCleanupStatus: cleanupErrorHash ? "REJECT" : "APPROVE",
    rawOutputDirRetained: runSummary?.rawOutputDirRetained ?? retainedRawOutputLabel(rawOutput),
    resultHash: runSummary?.resultHash ?? null,
    runErrorHash,
    signal: runSummary?.signal ?? null,
    specs: runSummary?.specs ?? [profileEditSpec],
    supabaseTempCleanup,
    supabaseTempCleanupErrorHash,
    visual: runSummary?.visual ?? { verdict: "REJECT" },
    visualPublication: { verdict: "PENDING" },
  }
  summary.visualPublication = await finishVisualWorkspace({
    shouldPublish: isApproved(summary),
    visualWorkspace,
  })
  const verdict = isApproved(summary) ? "APPROVE" : "REJECT"
  const evidence = { ...summary, cleanupErrorHash, verdict }
  await writeJsonMode600(outputPath, {
    ...evidence,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(evidence)),
    },
  })
  if (verdict === "APPROVE") {
    await writeProfileEditTerminalReceipt({ outputPath, visualDir: visualWorkspace.finalDir })
  }
  if (verdict !== "APPROVE") process.exitCode = 1
}

async function prepareVisualDirectory({ outputPath, requestedDir }) {
  try {
    const workspace = await prepareProfileEditVisualWorkspace({
      defaultVisualDir: ".omo/evidence/mypage-profile-edit/task-7-visual",
      outputPath,
      requestedDir,
    })
    return { verdict: "APPROVE", workspace }
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}

async function writeRejectedVisualSummary(outputPath, errorHash) {
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    cleanupErrorHash: null,
    exitCode: null,
    lastRun: { verdict: "REJECT" },
    outputInventory: { verdict: "REJECT" },
    playwrightReport: { verdict: "REJECT" },
    projects,
    rawOutputCleanupHash: null,
    rawOutputCleanupStatus: "APPROVE",
    rawOutputDirRetained: null,
    resultHash: null,
    runErrorHash: null,
    signal: null,
    specs: [profileEditSpec],
    supabaseTempCleanup: { verdict: "APPROVE" },
    supabaseTempCleanupErrorHash: null,
    visual: { errorHash, verdict: "REJECT" },
    visualPublication: { verdict: "REJECT" },
    verdict: "REJECT",
  }
  await writeJsonMode600(outputPath, {
    ...evidence,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(evidence)),
    },
  })
}

async function finishVisualWorkspace({ shouldPublish, visualWorkspace }) {
  try {
    return shouldPublish ? await visualWorkspace.publish() : await visualWorkspace.cleanup()
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
