import { spawn as defaultSpawn } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"

import { signalOwnedProcessGroup } from "./process-ownership.mjs"

const buildTimeoutMs = 5 * 60 * 1000
const outputTailLength = 8_192

export async function buildProductionWorkspace({ env, repoRoot, tempRoot }, overrides = {}) {
  const spawn = overrides.spawn ?? defaultSpawn
  const nextBinary = path.join(repoRoot, "node_modules/next/dist/bin/next")
  const child = spawn(process.execPath, [nextBinary, "build", "--webpack"], {
    cwd: tempRoot,
    detached: true,
    env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = { stderr: "", stdout: "" }
  child.stdout.on("data", (chunk) => {
    output.stdout = appendTail(output.stdout, chunk)
  })
  child.stderr.on("data", (chunk) => {
    output.stderr = appendTail(output.stderr, chunk)
  })

  const result = await waitForBuild(child, overrides.timeoutMs ?? buildTimeoutMs)
  const diagnostics = {
    exitCode: result.exitCode,
    signal: result.signal,
    stderrSha256: sha256(output.stderr),
    stderrTail: safeTail(output.stderr),
    stdoutSha256: sha256(output.stdout),
    stdoutTail: safeTail(output.stdout),
  }
  if (result.exitCode !== 0) {
    const error = new Error(`Isolated Next production build failed: ${JSON.stringify(diagnostics)}`)
    error.childDiagnostics = diagnostics
    throw error
  }
  return diagnostics
}

function waitForBuild(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => signalOwnedProcessGroup(child, "SIGKILL"), timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer)
      resolve({ exitCode: exitCode ?? 1, signal })
    })
  })
}

function appendTail(previous, chunk) {
  return `${previous}${chunk}`.slice(-outputTailLength)
}

function safeTail(value) {
  return value
    .slice(-480)
    .replace(/https?:\/\/\S+/giu, "<url>")
    .replace(/[A-Za-z0-9._-]{12,}/gu, "<redacted>")
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
