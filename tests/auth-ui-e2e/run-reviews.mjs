#!/usr/bin/env node
import path from "node:path"
import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"

const output =
  process.argv[2] ??
  path.join(".omo/evidence", "high-priority-missing-services/task-5/reviews.json")
const spec = "tests/auth-ui-e2e/reviews.spec.ts"
const result = await withConfiguredAuthMode(
  {
    cleanupReceiptPath: ".omo/evidence/high-priority-missing-services/task-5/browser-cleanup.json",
    enableConfirmations: false,
  },
  async ({ baseUrl, status }) => {
    const run = await runBuffered(
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
      ],
      {
        env: buildChildEnv(process.env, {
          NODE_ENV: "test",
          SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
          SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
        }),
      },
    )
    return {
      exitCode: run.exitCode,
      resultHash: sha256(`${run.stdout}${run.stderr}`),
      specs: [spec],
    }
  },
)
await writeJsonMode600(output, {
  ...result,
  schemaVersion: 1,
  verdict: result.exitCode === 0 ? "APPROVE" : "REJECT",
})
if (result.exitCode !== 0) process.exitCode = 1
