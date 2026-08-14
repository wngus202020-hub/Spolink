import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import path from "node:path"

import { resolveEvidenceChildPath } from "./evidence-paths.mjs"

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function writeJsonMode600(filePath, value, options = {}) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const candidatePath = path.resolve(filePath)
  const evidenceRelative = path.relative(path.join(repoRoot, ".omo/evidence"), candidatePath)
  const isEvidencePath =
    evidenceRelative.length > 0 &&
    !evidenceRelative.startsWith("..") &&
    !path.isAbsolute(evidenceRelative)
  const resolvedPath = isEvidencePath
    ? await resolveEvidenceChildPath(filePath, {
        kind: "file",
        repoRoot,
      })
    : candidatePath
  const parentPath = path.dirname(resolvedPath)
  const parentRealBefore = await realpath(parentPath)
  const target = await optionalLstat(resolvedPath)
  if (target?.isSymbolicLink()) throw new Error("JSON target is a symlink; no-follow write refused")
  const body = `${JSON.stringify(value, null, 2)}\n`
  const noFollow = constants.O_NOFOLLOW ?? 0
  let handle
  try {
    handle = await open(resolvedPath, constants.O_WRONLY | constants.O_CREAT | noFollow, 0o600)
    const opened = await handle.stat()
    if (!opened.isFile()) throw new Error("JSON target must be a regular file")
    if ((await realpath(parentPath)) !== parentRealBefore) {
      throw new Error("JSON target parent changed before write")
    }
    await handle.truncate(0)
    await handle.writeFile(body, "utf8")
    await handle.chmod(0o600)
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error("JSON target is a symlink; no-follow write refused", { cause: error })
    }
    throw error
  } finally {
    await handle?.close()
  }
  return sha256(body)
}

async function optionalLstat(filePath) {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

export function runBuffered(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    options.onChild?.(child)
    let stdout = ""
    let stderr = ""
    let killTimer = null
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      }, options.killAfterMs ?? 10_000)
    }, options.timeoutMs ?? 900_000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      reject(error)
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve({ exitCode: code ?? (signal ? 128 : 1), signal, stderr, stdout })
    })
  })
}

export async function stopChild(child, port = null) {
  if (!child.pid) return { exitCode: 0, signal: "none" }
  if (child.exitCode !== null || child.signalCode !== null) {
    if (port) await waitForPortFree(port)
    return { exitCode: child.exitCode ?? 0, signal: child.signalCode ?? "none" }
  }
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ exitCode: code ?? 0, signal }))
  })
  child.kill("SIGTERM")
  let timeoutId
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ exitCode: null, signal: "timeout" }), 10_000)
  })
  const result = await Promise.race([closed, timeout])
  clearTimeout(timeoutId)
  if (result.signal === "timeout") {
    child.kill("SIGKILL")
    const killed = await closed
    if (port) await waitForPortFree(port)
    return killed
  }
  if (port) await waitForPortFree(port)
  return result
}

export function trackActiveCommand(child) {
  return {
    child,
    closed: new Promise((resolve) => {
      child.once("close", (code, signal) => resolve({ exitCode: code ?? 0, signal }))
    }),
    stopping: false,
  }
}

export async function stopActiveCommand(active) {
  if (!active) return { exitCode: 0, signal: "none" }
  if (active.stopping) return active.closed
  active.stopping = true
  if (
    active.child.pid &&
    typeof active.child.exitCode !== "number" &&
    typeof active.child.signalCode !== "string"
  ) {
    active.child.kill("SIGTERM")
  }
  let timeoutId
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ signal: "timeout" }), 10_000)
  })
  const result = await Promise.race([active.closed, timeout])
  clearTimeout(timeoutId)
  if (result.signal === "timeout") {
    active.child.kill("SIGKILL")
    return active.closed
  }
  return result
}

export function buildChildEnv(parentEnv, entries) {
  const env = {}
  for (const key of ["PATH", "HOME", "TMPDIR"]) {
    const value = parentEnv[key]
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
    env[key] = value
  }
  return { ...env, ...entries }
}

async function waitForPortFree(port) {
  const { isLoopbackPortFree } = await import("./ports.mjs")
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isLoopbackPortFree(port)) return
    await delay(250)
  }
  throw new Error(`Port ${port} was not released`)
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
