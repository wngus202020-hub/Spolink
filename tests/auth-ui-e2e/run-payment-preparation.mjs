#!/usr/bin/env node
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const paymentSpec = "tests/auth-ui-e2e/payment-preparation.spec.ts"

async function main() {
  const [outputPath = path.join(".omo/evidence", "payment-preparation-focused-summary.json")] =
    process.argv.slice(2)
  const rawOutput = await prepareRawPlaywrightOutputDir({
    retain: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
    suppliedDir: process.env["SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR"] ?? null,
  })
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
            paymentSpec,
            "--project=desktop-chromium",
            "--project=mobile-chromium",
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
        return {
          exitCode: result.exitCode,
          rawOutputDirRetained: rawOutput.retained ? rawOutput.dir : null,
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          signal: result.signal,
          specs: [paymentSpec],
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

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
