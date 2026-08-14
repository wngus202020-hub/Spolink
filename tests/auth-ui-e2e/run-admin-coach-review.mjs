#!/usr/bin/env node
import { chmod, mkdir } from "node:fs/promises"
import path from "node:path"

import { hardenCoachApplicantArtifactRoots } from "./coach-applicant-artifacts.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/admin-coach-review.spec.ts"
const [outputPath = path.join(".omo/evidence", "admin-coach-review-summary.json")] =
  process.argv.slice(2)
const visualDir = process.env["SPOLINK_VISUAL_QA_DIR"]
if (!visualDir) throw new Error("SPOLINK_VISUAL_QA_DIR is required")
await mkdir(visualDir, { recursive: true })
await chmod(visualDir, 0o700)
const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })

try {
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
          spec,
          "--project=desktop-chromium",
          "--project=mobile-chromium",
          "--project=tablet-chromium",
        ],
        {
          env: buildChildEnv(process.env, {
            NODE_ENV: "test",
            SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
            SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
            SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
            SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status.serviceRoleKey,
            SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            SPOLINK_VISUAL_QA_DIR: visualDir,
          }),
        },
      )
      return {
        exitCode: result.exitCode,
        ...(result.exitCode === 0
          ? {}
          : { failureDetails: redactFailure(`${result.stdout}\n${result.stderr}`) }),
        resultHash: sha256(`${result.stdout}${result.stderr}`),
        signal: result.signal,
        specs: [spec],
      }
    },
  )
  const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
  await hardenCoachApplicantArtifactRoots([visualDir])
  await writeJsonMode600(outputPath, {
    ...summary,
    observables:
      verdict === "APPROVE"
        ? {
            applicantNotification: "exactly-one",
            applicantStatus: "coach_approved",
            publicEligibility: "visible",
            signedCertificateTtlSeconds: 300,
            viewports: ["desktop-chromium", "mobile-chromium", "tablet-chromium"],
          }
        : null,
    schemaVersion: 1,
    verdict,
  })
  if (verdict !== "APPROVE") process.exitCode = 1
} finally {
  await rawOutput.cleanup()
}

function redactFailure(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<uuid>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<email>")
    .slice(-30_000)
}
