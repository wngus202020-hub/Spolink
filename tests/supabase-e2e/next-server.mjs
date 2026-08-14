import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import net from "node:net"

import { readRuntimeReceipt, writeRuntimeReceipt } from "../../scripts/supabase-local/receipt.mjs"
import { assertNextTypeState, restoreNextDevRouteReference } from "./next-type-stability.mjs"

const envFilesLoadedByNext = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
  ".env.production",
  ".env.production.local",
])

export async function assertNoRootEnvFiles(repoRoot = process.cwd()) {
  const names = await readdir(repoRoot)
  const forbidden = names.filter((name) => envFilesLoadedByNext.has(name)).sort()
  if (forbidden.length > 0) {
    throw new Error(`Forbidden root env files for Next E2E: ${forbidden.join(", ")}`)
  }
  return { checked: [...envFilesLoadedByNext].sort(), allowed: [".env.example"] }
}

export async function assertNextTypeStability(repoRoot = process.cwd()) {
  await restoreNextDevRouteReference(repoRoot)
  return (await assertNextTypeState(repoRoot)).tsconfigSha256
}

export async function capturePort3002() {
  const output = await runBuffered("lsof", ["-nP", "-iTCP:3002", "-sTCP:LISTEN", "-t"])
  const pids = output.stdout.trim().split(/\s+/).filter(Boolean)
  if (pids.length === 0) return "none"
  if (pids.length === 1) return pids[0]
  throw new Error(`Expected at most one listener on 3002, found ${pids.join(",")}`)
}

export async function startNextServer({ mode, status, repoRoot = process.cwd() }) {
  const externalBaseUrl = process.env.SPOLINK_TEST_BASE_URL
  if (externalBaseUrl) {
    await waitForConfiguredState(externalBaseUrl, mode === "configured")
    return {
      baseUrl: externalBaseUrl.replace(/\/$/, ""),
      mode,
      ownedPid: null,
      port: new URL(externalBaseUrl).port ? Number(new URL(externalBaseUrl).port) : null,
      stop: async () => ({ signal: "none", exitCode: 0 }),
    }
  }

  const port = await selectNextPort(3006)
  const env = buildNextEnv({ mode, status })
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    { cwd: repoRoot, env, shell: false, stdio: ["ignore", "pipe", "pipe"] },
  )
  const output = { stderr: "", stdout: "" }
  child.stdout.on("data", (chunk) => {
    output.stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk
  })
  const server = {
    baseUrl: `http://127.0.0.1:${port}`,
    mode,
    ownedPid: child.pid,
    port,
    stop: () => stopOwnedChild(child, port, output),
  }
  await recordOwnedNext(repoRoot, server)
  await waitForConfiguredState(server.baseUrl, mode === "configured", output)
  return server
}

function buildNextEnv({ mode, status }) {
  const env = pickRequiredEnv(["PATH", "HOME", "TMPDIR"])
  if (mode === "configured") {
    if (!status?.apiUrl || !status?.anonKey) {
      throw new Error("Configured Next server requires local Supabase public status")
    }
    env.NEXT_PUBLIC_SUPABASE_URL = status.apiUrl
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.anonKey
  } else if (mode !== "unconfigured") {
    throw new Error(`Unknown Next server mode: ${mode}`)
  }
  return env
}

function pickRequiredEnv(keys) {
  const env = {}
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Missing required environment variable for Next child: ${key}`)
    }
    env[key] = value
  }
  return env
}

async function selectNextPort(firstPort) {
  for (let port = firstPort; port < firstPort + 200; port += 1) {
    if (port !== 3002 && (await isPortFree(port))) return port
  }
  throw new Error("No free loopback port for Next E2E")
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}

async function waitForConfiguredState(baseUrl, configured, output = { stderr: "", stdout: "" }) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config/supabase`)
      if (response.ok) {
        const body = await response.json()
        if (body.configured === configured) return
      }
    } catch {
      // Retry until the bounded readiness deadline.
    }
    await delay(250)
  }
  throw new Error(
    `Next ${configured ? "configured" : "unconfigured"} readiness timed out\n${output.stderr}`,
  )
}

async function stopOwnedChild(child, port, output) {
  if (!child.pid) return { signal: "none", exitCode: 0 }
  const close = onceClose(child)
  child.kill("SIGTERM")
  const exitCode = await Promise.race([close, delay(10_000).then(() => null)])
  if (exitCode === null && isProcessAlive(child.pid)) {
    child.kill("SIGKILL")
    const killedExitCode = await close
    await waitForPortFree(port)
    return { signal: "SIGKILL", exitCode: killedExitCode, stderr: output.stderr.slice(-1200) }
  }
  await waitForPortFree(port)
  return { signal: "SIGTERM", exitCode, stderr: output.stderr.slice(-1200) }
}

function onceClose(child) {
  return new Promise((resolve) => {
    child.once("close", (code) => resolve(code ?? 0))
  })
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForPortFree(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isPortFree(port)) return
    await delay(250)
  }
  throw new Error(`Next E2E port ${port} was not released`)
}

async function recordOwnedNext(repoRoot, server) {
  const receiptPath = `${repoRoot}/.omo/evidence/runtime-receipt-supabase-auth-rls-e2e.json`
  const receipt = await readRuntimeReceipt(receiptPath)
  await writeRuntimeReceipt(receiptPath, {
    ...receipt,
    ownedPids: uniqueNumbers([...receipt.ownedPids, server.ownedPid]),
    selectedNextPorts: uniqueNumbers([...receipt.selectedNextPorts, server.port]),
  })
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort(
    (left, right) => left - right,
  )
}

function runBuffered(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 0, stdout, stderr }))
  })
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
