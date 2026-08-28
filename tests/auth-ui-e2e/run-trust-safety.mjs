#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import net from "node:net"
import path from "node:path"

import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

const [
  requestedOutput = ".omo/evidence/high-priority-missing-services/task-9/browser-summary.json",
] = process.argv.slice(2)
const nextRoot = process.env.SPOLINK_TASK9_NEXT_ROOT ?? process.cwd()
const outputPath = await resolveEvidenceChildPath(requestedOutput, {
  kind: "file",
  repoRoot: process.cwd(),
  suffix: ".json",
})
const visualQaDir = await resolveEvidenceChildPath(
  ".omo/evidence/high-priority-missing-services/task-9/visual",
  { kind: "directory", repoRoot: process.cwd() },
)
const cleanupReceiptPath = outputPath.replace(/\.json$/u, ".cleanup.json")
const rawOutput = await prepareRawPlaywrightOutputDir({ retain: false, suppliedDir: null })
const baseUrl = "http://127.0.0.1:3016"

await mkdir(path.dirname(outputPath), { mode: 0o700, recursive: true })
await mkdir(visualQaDir, { mode: 0o700, recursive: true })

let nextProcess = null
try {
  const status = await readGuardedLocalStatus()
  nextProcess = spawn(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3016"],
    {
      cwd: nextRoot,
      detached: true,
      env: buildChildEnv(process.env, {
        SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE: "enabled",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        NODE_ENV: "test",
        SPOLINK_AUTH_FLOW_SECRET: Buffer.alloc(32, 7).toString("base64url"),
        SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  const nextOutput = collectBoundedOutput(nextProcess)
  await waitForHttp(baseUrl, nextProcess)

  const result = await runBuffered(
    "corepack",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--config=playwright.auth.config.ts",
      "tests/auth-ui-e2e/trust-safety.spec.ts",
      "--project=desktop-chromium",
      "--project=mobile-chromium",
      "--project=tablet-chromium",
    ],
    {
      env: buildChildEnv(process.env, {
        SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE: "enabled",
        NODE_ENV: "test",
        SPOLINK_AUTH_E2E_API_URL: status.apiUrl,
        SPOLINK_AUTH_E2E_ANON_KEY: status.anonKey,
        SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
        SPOLINK_AUTH_E2E_DB_URL: status.dbUrl,
        SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutput.dir,
        SPOLINK_AUTH_E2E_SERVICE_ROLE_KEY: status.serviceRoleKey,
        SPOLINK_VISUAL_QA_DIR: visualQaDir,
      }),
    },
  )
  if (result.exitCode !== 0) console.error(redact(`${result.stdout}\n${result.stderr}`))
  const verdict = result.exitCode === 0 ? "APPROVE" : "REJECT"
  await writeJsonMode600(outputPath, {
    exitCode: result.exitCode,
    nextOutputHash: sha256(nextOutput()),
    resultHash: sha256(`${result.stdout}${result.stderr}`),
    scenarios: 3,
    schemaVersion: 1,
    signal: result.signal,
    verdict,
    viewports: [390, 768, 1280],
  })
  if (verdict !== "APPROVE") process.exitCode = 1
} catch (error) {
  await writeJsonMode600(outputPath, {
    error: redact(error instanceof Error ? error.message : String(error)),
    schemaVersion: 1,
    verdict: "REJECT",
  })
  process.exitCode = 1
} finally {
  const stopped = await stopProcessGroup(nextProcess)
  await writeJsonMode600(cleanupReceiptPath, {
    nextPort: 3016,
    nextStopped: stopped,
    portFreeConfirmed: stopped,
    schemaVersion: 1,
    supabaseOwnership: "external-guarded-lifecycle",
    verdict: stopped ? "APPROVE" : "REJECT",
  })
  await rawOutput.cleanup()
}

async function waitForHttp(url, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Next exited before becoming ready")
    try {
      const response = await fetch(`${url}/api/config/supabase`)
      if (response.ok && (await response.json()).configured === true) return
    } catch (caught) {
      if (!(caught instanceof TypeError)) throw caught
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Next readiness timed out")
}

function collectBoundedOutput(child) {
  let output = ""
  const append = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-20_000)
  }
  child.stdout?.on("data", append)
  child.stderr?.on("data", append)
  return () => output
}

async function stopProcessGroup(child) {
  const pid = child?.pid
  if (!pid) return await waitForPortFree(3016)
  if (child.exitCode === null) process.kill(-pid, "SIGTERM")
  if (await waitForPortFree(3016, 10_000)) return true
  if (child.exitCode === null) process.kill(-pid, "SIGKILL")
  return await waitForPortFree(3016, 10_000)
}

async function waitForPortFree(port, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return await isPortFree(port)
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port })
    const finish = (free) => {
      socket.destroy()
      resolve(free)
    }
    socket.once("connect", () => finish(false))
    socket.once("error", () => finish(true))
    socket.setTimeout(500, () => finish(true))
  })
}

function redact(value) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu, "<uuid>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "<email>")
    .replace(/\/Users\/[^/\s]+/gu, "<home>")
    .slice(-20_000)
}
