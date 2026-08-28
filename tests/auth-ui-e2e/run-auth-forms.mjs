#!/usr/bin/env node
import path from "node:path"

import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const authFormSpec = "tests/auth-ui-e2e/auth-forms.spec.ts"

async function main() {
  const [
    requestedOutputPath = path.join(".omo/evidence", "todo5-auth-forms-focused-summary.json"),
  ] = process.argv.slice(2)
  const outputPath = await resolveEvidenceChildPath(requestedOutputPath, {
    kind: "file",
    suffix: ".json",
  })
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
  const cleanupReceiptPath = await resolveEvidenceChildPath(
    process.env["SPOLINK_AUTH_E2E_CLEANUP_RECEIPT_FILE"] ?? cleanupPathFor(outputPath),
    { kind: "file", suffix: ".json" },
  )
  let summary = null
  try {
    summary = await withConfiguredAuthMode(
      {
        cleanupReceiptPath,
        enableConfirmations: false,
        evidencePaths: [cleanupReceiptPath, outputPath],
      },
      async ({ baseUrl, lifecycle, status }) => {
        const result = await lifecycle.runBrowserChild(
          "corepack",
          [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config=playwright.auth.config.ts",
            authFormSpec,
            "--project=desktop-chromium",
            "--project=mobile-chromium",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
            }),
          },
        )
        return {
          exitCode: result.exitCode,
          rawOutputDirRetained: rawOutput.retained ? rawOutput.dir : null,
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          signal: result.signal,
          specs: [authFormSpec],
        }
      },
    )
    const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
    await writeJsonMode600(outputPath, {
      ...summary,
      schemaVersion: 1,
      verdict,
    })
    if (verdict !== "APPROVE") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

function cleanupPathFor(outputPath) {
  return outputPath.endsWith(".json")
    ? `${outputPath.slice(0, -".json".length)}.cleanup.json`
    : `${outputPath}.cleanup.json`
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
