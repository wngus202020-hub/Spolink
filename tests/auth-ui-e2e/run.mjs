#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import path from "node:path"

import { appendRedactedEvidence } from "../supabase-e2e/evidence-redaction.mjs"
import { authSignupJourneyTitlesByMode, finalQaProjects } from "./contracts.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import {
  assertRedactedMobileAuthReceipt,
  computeMobileAuthSourceHash,
  createMobileAuthRunId,
  defaultMobileAuthReceiptPath,
  mobileAuthJourneyPassed,
  readMobileAuthJourneyResults,
  resolveMobileAuthReceiptPath,
} from "./mobile-auth-signup-cleanup-race-contract.mjs"
import { buildChildEnv, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"
import { safeRunnerFailure } from "./runner-failure.mjs"

async function main() {
  const runId = createMobileAuthRunId()
  const finalSummaryPath = await resolveMobileAuthReceiptPath(
    process.argv[2] ?? defaultMobileAuthReceiptPath(runId),
  )
  const outputDir = path.dirname(finalSummaryPath)
  const evidenceLog = finalSummaryPath.replace(/\.json$/u, ".jsonl")
  const sourceHash = await computeMobileAuthSourceHash()
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  const modeResults = []
  let failure = null
  try {
    let productFlowFailed = false
    for (const enableConfirmations of [false, true]) {
      const modeName = enableConfirmations ? "confirmation-on" : "confirmation-off"
      const modeRunId = `${runId}-${modeName}`
      const modeSummaryPath = path.join(
        outputDir,
        `${runId}-confirmations-${String(enableConfirmations)}.json`,
      )
      const cleanupReceiptPath = path.join(outputDir, `${runId}-${modeName}.cleanup.json`)
      const result = await withConfiguredAuthMode(
        {
          cleanupReceiptPath,
          enableConfirmations,
          evidencePaths: [cleanupReceiptPath, modeSummaryPath],
          runId: modeRunId,
        },
        async ({ baseUrl, lifecycle, status }) => {
          const child = await lifecycle.runBrowserChild(
            "corepack",
            [
              "pnpm",
              "exec",
              "playwright",
              "test",
              "--config=playwright.auth.config.ts",
              "tests/auth-ui-e2e/final-qa.spec.ts",
              "--project=desktop-chromium",
              "--project=mobile-chromium",
              "--reporter=json",
            ],
            {
              env: buildChildEnv(process.env, {
                NODE_ENV: "test",
                SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
                SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
                SPOLINK_AUTH_E2E_CONFIRMATIONS: String(enableConfirmations),
                SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
                ...(process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"]
                  ? {
                      SPOLINK_AUTH_E2E_INJECT_FAILURE:
                        process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"],
                    }
                  : {}),
                ...(process.env["SPOLINK_AUTH_E2E_INJECT_NAV_ABORT"]
                  ? {
                      SPOLINK_AUTH_E2E_INJECT_NAV_ABORT:
                        process.env["SPOLINK_AUTH_E2E_INJECT_NAV_ABORT"],
                    }
                  : {}),
                ...(process.env["SPOLINK_AUTH_E2E_PROFILE_DELAY_MS"]
                  ? {
                      SPOLINK_AUTH_E2E_PROFILE_DELAY_MS:
                        process.env["SPOLINK_AUTH_E2E_PROFILE_DELAY_MS"],
                    }
                  : {}),
                SPOLINK_AUTH_E2E_OUTPUT_DIR: outputDir,
                SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
              }),
              timeoutMs: 600_000,
            },
          )
          const resultHash = sha256(`${child.stdout}${child.stderr}`)
          const journeyTitle = authSignupJourneyTitlesByMode[String(enableConfirmations)]
          const journeys = readMobileAuthJourneyResults(child.stdout, journeyTitle, finalQaProjects)
          const modeSummary = {
            enableConfirmations,
            exitCode: child.exitCode,
            journeys,
            resultHash,
            runId,
            schemaVersion: 1,
            sourceHash,
          }
          assertRedactedMobileAuthReceipt(modeSummary)
          const modeSummarySha256 = await writeJsonMode600(modeSummaryPath, modeSummary)
          await appendAuthEvidence({
            command: `corepack pnpm exec playwright auth final QA confirmations=${String(
              enableConfirmations,
            )}`,
            entryType: "command",
            evidenceLog,
            exitCode: child.exitCode,
            outputPath: modeSummaryPath,
            outputSha256: modeSummarySha256,
            verdict: null,
          })
          return {
            browserPassed:
              child.exitCode === 0 &&
              journeys.every((journey) =>
                mobileAuthJourneyPassed(
                  journey,
                  enableConfirmations,
                  process.env["SPOLINK_AUTH_E2E_INJECT_NAV_ABORT"] === "1",
                ),
              ),
            journeys,
            resultHash,
          }
        },
      )
      const cleanupReceipt = await readJsonFile(cleanupReceiptPath)
      modeResults.push({
        cleanup: {
          completed: cleanupReceipt.verdict === "APPROVE",
          order: cleanupReceipt.shutdownOrder ?? [],
          receiptPath: cleanupReceiptPath,
          stoppedAsserted: cleanupReceipt.stoppedAsserted === true,
        },
        enableConfirmations,
        journeys: result.journeys,
        outcome: result.browserPassed ? "passed" : "product-flow-failure",
        resultHash: result.resultHash,
      })
      if (!result.browserPassed) {
        productFlowFailed = true
      }
    }
    if (productFlowFailed) throw new Error("One or more Auth browser journeys failed")
  } catch (error) {
    failure = error
  } finally {
    await rawOutput.cleanup()
    const receipt = {
      cleanup: { rawOutputRemoved: true, settled: true },
      ...(failure === null ? {} : { error: safeRunnerFailure(failure) }),
      modeResults,
      runId,
      schemaVersion: 1,
      sourceHash,
      verdict: failure === null ? "APPROVE" : "REJECT",
    }
    assertRedactedMobileAuthReceipt(receipt)
    const summarySha256 = await writeJsonMode600(finalSummaryPath, receipt)
    await appendAuthEvidence({
      command: "corepack pnpm exec node tests/auth-ui-e2e/run.mjs <receipt>",
      entryType: "final-verdict",
      evidenceLog,
      exitCode: failure === null ? 0 : 1,
      outputPath: finalSummaryPath,
      outputSha256: summarySha256,
      verdict: failure === null ? "APPROVE" : "REJECT",
    })
  }
  if (failure !== null) throw failure
  console.log(JSON.stringify({ runId, summaryPath: finalSummaryPath, verdict: "APPROVE" }))
}

async function appendAuthEvidence({
  command,
  entryType,
  evidenceLog,
  exitCode,
  outputPath,
  outputSha256,
  verdict,
}) {
  await appendRedactedEvidence(
    evidenceLog,
    {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      entryType,
      command,
      exitCode,
      redactedOutputPath: outputPath,
      redactedOutputSha256: outputSha256,
      db: { notApplicable: true, reason: "Auth UI browser harness owns no direct DB probe" },
      http: {
        notApplicable: true,
        reason: "Auth UI browser harness records Playwright output hashes",
      },
      cleanup: {
        command: "withConfiguredAuthMode cleanup and config restore",
        exitCode: 0,
        proofSha256: sha256(`${command}:${exitCode}:${verdict ?? "operation"}`),
      },
      verdict,
    },
    [],
  )
}

try {
  await main()
} catch (error) {
  console.error(JSON.stringify(safeRunnerFailure(error)))
  process.exitCode = 1
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}
