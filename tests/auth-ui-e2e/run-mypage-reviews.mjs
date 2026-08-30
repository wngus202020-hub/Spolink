#!/usr/bin/env node

import { constants } from "node:fs"
import { access, readFile } from "node:fs/promises"
import path from "node:path"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import {
  allCountersAreZero,
  assertNoSensitiveEvidence,
  projects,
  readProjectReceipts,
  redactDiagnostic,
  sha256,
  sourceManifest,
  writeMode600Json,
} from "./mypage-reviews-evidence.mjs"
import { buildChildEnv, runBuffered } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const expectedScenarios = [
  "anonymous_redirect",
  "profile_required_redirect",
  "real_create_and_admin_hide",
  "owner_a_history_and_pagination",
  "owner_b_isolation",
  "public_visible_only",
  "out_of_range_recovery",
  "controlled_read_failure",
]
const spec = "tests/auth-ui-e2e/mypage-reviews.spec.ts"

async function main() {
  const requestedOutputPath =
    process.argv[2] ??
    path.join(".omo/evidence", "mypage-reviews-management/task-6/focused-summary.json")
  const outputPath = await resolveEvidenceChildPath(requestedOutputPath, {
    kind: "file",
    suffix: ".json",
  })
  const evidenceDir = path.dirname(outputPath)
  const cleanupReceiptPath = await resolveEvidenceChildPath(
    path.join(evidenceDir, "cleanup.json"),
    {
      kind: "file",
      suffix: ".json",
    },
  )
  const sourceManifestPath = await resolveEvidenceChildPath(
    path.join(evidenceDir, "source-manifest.json"),
    { kind: "file", suffix: ".json" },
  )
  if (new Set([outputPath, cleanupReceiptPath, sourceManifestPath]).size !== 3) {
    throw new Error("Review evidence paths must be distinct.")
  }
  await Promise.all(
    [outputPath, cleanupReceiptPath, sourceManifestPath].map(assertWritableEvidenceTarget),
  )
  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  let run = null
  let receipts = []
  let lifecycleErrorHash = null
  try {
    try {
      run = await withConfiguredAuthMode(
        { cleanupReceiptPath, enableConfirmations: false },
        async ({ baseUrl, status }) => {
          const child = await runBuffered(
            "corepack",
            [
              "pnpm",
              "exec",
              "playwright",
              "test",
              "--config=playwright.auth.config.ts",
              spec,
              "--project=mobile-chromium",
              "--project=tablet-chromium",
              "--project=desktop-chromium",
              "--workers=1",
              "--reporter=line",
            ],
            {
              env: buildChildEnv(process.env, {
                NODE_ENV: "test",
                SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
                SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
                SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
                SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE:
                  process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE"] ?? "0",
              }),
              timeoutMs: 180_000,
            },
          )
          if (child.exitCode !== 0) {
            console.error(redactDiagnostic(`${child.stdout}\n${child.stderr}`))
          }
          receipts = await readProjectReceipts(rawOutput.dir)
          return {
            exitCode: child.exitCode,
            resultHash: sha256(`${child.stdout}${child.stderr}`),
            signal: child.signal,
          }
        },
      )
    } catch (error) {
      lifecycleErrorHash = sha256(error instanceof Error ? error.message : String(error))
    }

    const cleanup = await readJsonOrReject(cleanupReceiptPath)
    const currentSources = await sourceManifest()
    await writeMode600Json(sourceManifestPath, {
      files: currentSources,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    const injectionRequested = process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE"] === "1"
    const scenariosApprove = receipts.every(
      (receipt) =>
        expectedScenarios.every((scenario) => receipt.scenarios.includes(scenario)) &&
        receipt.grantRestored === true,
    )
    const cleanupApprove = allCountersAreZero(receipts)
    const lifecycleApprove =
      cleanup.verdict === "APPROVE" &&
      cleanup.stoppedAsserted === true &&
      cleanup.cleanup?.config === "external-removed"
    const injectionObserved = receipts.some((receipt) => receipt.injectedFailure === true)
    const functionalApprove =
      !injectionRequested &&
      run?.exitCode === 0 &&
      receipts.length === projects.length &&
      scenariosApprove &&
      cleanupApprove &&
      lifecycleApprove &&
      lifecycleErrorHash === null
    const verdict = functionalApprove ? "APPROVE" : "REJECT"
    const summary = {
      cleanup: { exactCountersAllZero: cleanupApprove, lifecycle: cleanup },
      exitCode: run?.exitCode ?? null,
      failureInjection: {
        observed: injectionObserved,
        requested: injectionRequested,
        restorationProved: injectionObserved && cleanupApprove && lifecycleApprove,
      },
      generatedAt: new Date().toISOString(),
      fixtureCleanup: receipts.map((receipt) => ({
        cleanupCounters: receipt.cleanup.cleanupCounters,
        project: receipt.project,
        verdict: receipt.cleanup.verdict,
      })),
      lifecycleErrorHash,
      projects,
      resultHash: run?.resultHash ?? null,
      scenarioResults: receipts.map((receipt) => ({
        project: receipt.project,
        scenarios: receipt.scenarios.map((scenario) => ({ scenario, verdict: "APPROVE" })),
      })),
      schemaVersion: 2,
      signal: run?.signal ?? null,
      sourceManifest: currentSources,
      specs: [spec],
      verdict,
    }
    assertNoSensitiveEvidence(summary)
    await writeMode600Json(outputPath, summary)
    if (verdict !== "APPROVE") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

async function assertWritableEvidenceTarget(filePath) {
  try {
    await access(filePath, constants.W_OK)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error
    await access(path.dirname(filePath), constants.W_OK)
  }
}

async function readJsonOrReject(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
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
