#!/usr/bin/env node
import path from "node:path"
import { fileURLToPath } from "node:url"

import { hardenCoachApplicantArtifactRoots } from "./coach-applicant-artifacts.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const specs = [
  "tests/auth-ui-e2e/coach-apply.spec.ts",
  "tests/auth-ui-e2e/coach-apply-failure-states.spec.ts",
  "tests/auth-ui-e2e/coach-application-status.spec.ts",
  "tests/auth-ui-e2e/admin-coach-review.spec.ts",
]

const failurePoints = new Set([
  "after-config",
  "after-next-ready",
  "after-upload",
  "after-submit",
  "after-review",
])

export async function runCoachCertification() {
  const [requestedOutputPath = path.join(".omo/evidence", "coach-applicant-summary.json")] =
    process.argv.slice(2)
  const requestedVisualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  const injection = readFailureInjection()
  const { outputPath, visualQaDir } = await resolveCoachApplicantEvidencePaths({
    outputPath: requestedOutputPath,
    visualQaDir: requestedVisualQaDir,
  })
  const cleanupReceiptPath = outputPath.replace(/\.json$/u, ".cleanup.json")
  const publishedRoots = [cleanupReceiptPath, outputPath, ...(visualQaDir ? [visualQaDir] : [])]
  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  try {
    const previousLifecycleInjection = process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"]
    if (injection === "after-config" || injection === "after-next-ready") {
      process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"] = injection
    }
    let summary
    try {
      summary = await withConfiguredAuthMode(
        {
          cleanupReceiptPath,
          enableCoachUiFixtures: true,
          enableConfirmations: false,
          evidencePaths: [cleanupReceiptPath, outputPath],
          runId: `coach-certification-${Date.now().toString(36)}-${process.pid}`,
        },
        async ({ baseUrl, status }) => {
          const result = await runBuffered(
            "corepack",
            [
              "pnpm",
              "exec",
              "playwright",
              "test",
              "--config=playwright.auth.config.ts",
              ...specs,
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
                SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
                SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status.serviceRoleKey,
                ...(injection ? { SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE: injection } : {}),
                ...(visualQaDir ? { SPOLINK_VISUAL_QA_DIR: visualQaDir } : {}),
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
            specs,
          }
        },
      )
    } catch (error) {
      summary = {
        exitCode: 1,
        failureDetails: redactFailure(error instanceof Error ? error.message : String(error)),
        injection,
        signal: null,
        specs,
      }
    } finally {
      if (previousLifecycleInjection === undefined) {
        delete process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"]
      } else {
        process.env["SPOLINK_AUTH_E2E_INJECT_FAILURE"] = previousLifecycleInjection
      }
    }
    const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
    await writeJsonMode600(outputPath, { ...summary, schemaVersion: 1, verdict })
    if (verdict !== "APPROVE") process.exitCode = 1
  } finally {
    try {
      await hardenCoachApplicantArtifactRoots(publishedRoots)
    } finally {
      await rawOutput.cleanup()
    }
  }
}

function redactFailure(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<uuid>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<email>")
    .replace(/\/Users\/[^/\s]+/gu, "<home>")
    .slice(-30_000)
}

function readFailureInjection() {
  const value = process.env["SPOLINK_COACH_CERTIFICATION_INJECT_FAILURE"]
  if (!value) return null
  if (!failurePoints.has(value)) {
    throw new Error(`Unsupported coach certification failure point: ${value}`)
  }
  return value
}

export async function resolveCoachApplicantEvidencePaths({
  outputPath = path.join(".omo/evidence", "coach-applicant-summary.json"),
  visualQaDir,
  repoRoot = process.cwd(),
} = {}) {
  const resolvedOutputPath = await resolveEvidenceChildPath(outputPath, {
    kind: "file",
    repoRoot,
    suffix: ".json",
  })
  const resolvedVisualQaDir = visualQaDir
    ? await resolveEvidenceChildPath(visualQaDir, { kind: "directory", repoRoot })
    : undefined
  return { outputPath: resolvedOutputPath, visualQaDir: resolvedVisualQaDir }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runCoachCertification()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
