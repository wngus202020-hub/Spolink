#!/usr/bin/env node

import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { withConfiguredAuthMode } from "./lifecycle.mjs"

const outputDir = await mkdtemp(path.join(os.tmpdir(), "spolink-profile-avatar-"))

try {
  await withConfiguredAuthMode({ enableConfirmations: false }, async ({ baseUrl, status }) => {
    const exitCode = await runPlaywright({ baseUrl, dbUrl: status.dbUrl, outputDir })
    if (exitCode !== 0)
      throw new Error(`Profile avatar browser QA failed with exit code ${exitCode}.`)
  })
} finally {
  await rm(outputDir, { force: true, recursive: true })
}

function runPlaywright({ baseUrl, dbUrl, outputDir }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "corepack",
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config=playwright.auth.config.ts",
        "tests/auth-ui-e2e/profile-avatar.spec.ts",
        "--project=desktop-chromium",
        "--project=tablet-chromium",
        "--project=mobile-chromium",
        "--workers=1",
        "--reporter=list",
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "test",
          SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
          SPOLINK_AUTH_E2E_DB_URL: dbUrl,
          SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: outputDir,
        },
        stdio: "inherit",
      },
    )
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Profile avatar browser QA exited from ${signal}.`))
        return
      }
      resolve(code ?? 1)
    })
  })
}
