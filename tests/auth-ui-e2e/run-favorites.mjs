#!/usr/bin/env node
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const favoriteSpec = "tests/auth-ui-e2e/favorites.spec.ts"

async function main() {
  const [outputPath = path.join(".omo/evidence", "favorites-focused-summary.json")] =
    process.argv.slice(2)
  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  try {
    const summary = await withConfiguredAuthMode(
      {
        cleanupReceiptPath:
          process.env["SPOLINK_FAVORITES_CLEANUP_RECEIPT"] ??
          ".omo/evidence/high-priority-missing-services/task-4/browser-cleanup.json",
        enableConfirmations: false,
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
            favoriteSpec,
            "--project=mobile-chromium",
            "--project=tablet-chromium",
            "--project=desktop-chromium",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
              ...(process.env["SPOLINK_VISUAL_QA_DIR"]
                ? { SPOLINK_VISUAL_QA_DIR: process.env["SPOLINK_VISUAL_QA_DIR"] }
                : {}),
            }),
          },
        )
        if (result.exitCode !== 0) {
          console.error(redactDiagnostic(`${result.stdout}\n${result.stderr}`))
        }
        return {
          exitCode: result.exitCode,
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          signal: result.signal,
          specs: [favoriteSpec],
        }
      },
    )
    const verdict = summary.exitCode === 0 ? "APPROVE" : "REJECT"
    await writeJsonMode600(outputPath, { ...summary, schemaVersion: 1, verdict })
    if (verdict !== "APPROVE") process.exitCode = 1
  } finally {
    await rawOutput.cleanup()
  }
}

function redactDiagnostic(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/https?:\/\/[^\s)'"]+/gi, "<url>")
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
