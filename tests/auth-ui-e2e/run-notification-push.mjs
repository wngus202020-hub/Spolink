#!/usr/bin/env node
import { randomBytes } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import webPush from "web-push"

import { withConfiguredAuthMode } from "./lifecycle.mjs"
import { buildChildEnv, runBuffered } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const spec = "tests/auth-ui-e2e/notification-push.spec.ts"
const visualQaDir = path.resolve(
  process.env["SPOLINK_VISUAL_QA_DIR"] ?? ".omo/evidence/notification-push/screenshots",
)

async function main() {
  const vapidKeys = webPush.generateVAPIDKeys()
  process.env["NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY"] = vapidKeys.publicKey
  process.env["WEB_PUSH_VAPID_PRIVATE_KEY"] = vapidKeys.privateKey
  process.env["WEB_PUSH_VAPID_SUBJECT"] = "mailto:qa@spolink.test"
  process.env["SPOLINK_EDGE_SECRET"] = randomBytes(24).toString("base64url")
  await rm(visualQaDir, { force: true, recursive: true })
  await mkdir(visualQaDir, { recursive: true })

  const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
  try {
    const result = await withConfiguredAuthMode(
      { enableConfirmations: false },
      async ({ baseUrl, status }) =>
        runBuffered(
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
            "--workers=1",
            "--reporter=line",
          ],
          {
            env: buildChildEnv(process.env, {
              NODE_ENV: "test",
              SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
              SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
              SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
              SPOLINK_VISUAL_QA_DIR: visualQaDir,
            }),
            timeoutMs: 240_000,
          },
        ),
    )
    if (result.exitCode !== 0) {
      process.stderr.write(result.stderr)
      process.stderr.write(result.stdout)
      process.exitCode = 1
    } else {
      process.stdout.write(result.stdout)
    }
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
