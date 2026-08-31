#!/usr/bin/env node

import { constants } from "node:fs"
import { access, rm } from "node:fs/promises"
import path from "node:path"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import {
  assertNoSensitiveEvidence,
  readProjectReceipts,
  redactDiagnostic,
  sha256,
  sourceManifest,
} from "./mypage-reviews-evidence.mjs"
import { finalizeMypageReviewsRun } from "./mypage-reviews-runner-finalize.mjs"
import { expectedVisualImages, removePublishedVisuals } from "./mypage-reviews-visual-evidence.mjs"
import { buildChildEnv, runBuffered } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const exactVisualImageCount = 9
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
    path.join(".omo/evidence", "mypage-reviews-management/task-7/focused-summary.json")
  const outputPath = await resolveEvidenceChildPath(requestedOutputPath, {
    kind: "file",
    suffix: ".json",
  })
  const paths = await resolveOutputPaths(outputPath)
  const allPaths = [outputPath, paths.cleanup, paths.lifecycleCleanup, paths.manifest, paths.visual]
  if (new Set(allPaths).size !== allPaths.length)
    throw new Error("Review evidence paths must be distinct.")
  await Promise.all(allPaths.map(assertWritableEvidenceTarget))
  await removePublishedVisuals(paths.screenshots)
  await Promise.all(allPaths.map((file) => rm(file, { force: true })))

  const [initialSources, parentSha] = await Promise.all([sourceManifest(), readParentSha()])
  if (expectedVisualImages.length !== exactVisualImageCount) {
    throw new Error("Review visual image contract must contain exactly nine entries.")
  }
  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  let run = null
  let receipts = []
  let lifecycleErrorHash = null
  try {
    try {
      run = await withConfiguredAuthMode(
        { cleanupReceiptPath: paths.lifecycleCleanup, enableConfirmations: false },
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
                SPOLINK_MYPAGE_REVIEWS_INJECT_VISUAL_FAILURE:
                  process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_VISUAL_FAILURE"] ?? "0",
                SPOLINK_MYPAGE_REVIEWS_VISUAL_STAGING_DIR: path.join(rawOutput.dir, "visuals"),
              }),
              timeoutMs: 360_000,
            },
          )
          if (child.exitCode !== 0)
            console.error(redactDiagnostic(`${child.stdout}\n${child.stderr}`))
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

    const injectionRequested =
      process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE"] === "1" ||
      process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_VISUAL_FAILURE"] === "1"
    const finalized = await finalizeMypageReviewsRun({
      exactVisualImageCount,
      expectedScenarios,
      initialSources,
      injectionRequested,
      lifecycleErrorHash,
      outputPath,
      parentSha,
      paths,
      rawOutputDir: rawOutput.dir,
      receipts,
      run,
      spec,
    })
    assertNoSensitiveEvidence(finalized)
    if (finalized.verdict !== "APPROVE") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

async function resolveOutputPaths(outputPath) {
  const evidenceDir = path.dirname(outputPath)
  const resolveJson = (name) =>
    resolveEvidenceChildPath(path.join(evidenceDir, name), {
      kind: "file",
      suffix: ".json",
    })
  return {
    cleanup: await resolveJson("cleanup.json"),
    lifecycleCleanup: await resolveJson("lifecycle-cleanup.json"),
    manifest: await resolveJson("source-manifest.json"),
    screenshots: path.join(evidenceDir, "screenshots"),
    visual: await resolveJson("visual-summary.json"),
  }
}

async function readParentSha() {
  const result = await runBuffered("git", ["rev-parse", "HEAD"], { timeoutMs: 10_000 })
  const value = result.stdout.trim()
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/u.test(value))
    throw new Error("Unable to bind parent SHA.")
  return value
}

async function assertWritableEvidenceTarget(filePath) {
  try {
    await access(filePath, constants.W_OK)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error
    await access(path.dirname(filePath), constants.W_OK)
  }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
