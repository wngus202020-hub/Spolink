#!/usr/bin/env node
import path from "node:path"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/onboarding-shell.spec.ts"

async function main() {
  const [outputPath = path.join(".omo/evidence", "todo6-onboarding-shell-summary.json")] =
    process.argv.slice(2)
  const rawOutput = await prepareRawPlaywrightOutputDir()
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
        if (result.exitCode !== 0)
          console.error(redactFailure(`${result.stdout}\n${result.stderr}`))
        return {
          exitCode: result.exitCode,
          playwright: readPlaywrightSummary(result.stdout),
          resultHash: sha256(`${result.stdout}${result.stderr}`),
          signal: result.signal,
          spec,
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

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

function redactFailure(value) {
  return value
    .replace(/\b[A-Za-z0-9._%+-]+@spolink\.test\b/giu, "<redacted-email>")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "<redacted-postgres-url>")
}

function readPlaywrightSummary(output) {
  const readCount = (label) =>
    Number(output.match(new RegExp(`\\b(\\d+) ${label}\\b`, "u"))?.[1] ?? 0)
  const passedCount = readCount("passed")
  const failedCount = readCount("failed")
  const skippedCount = readCount("skipped")

  return {
    failedCount,
    passedCount,
    skippedCount,
    testCount: passedCount + failedCount + skippedCount,
  }
}
