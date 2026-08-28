import { spawn } from "node:child_process"
import { realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export async function copyWorkspace(repoRoot, tempRoot) {
  const result = await runBuffered(
    "rsync",
    [
      "-a",
      "--exclude=.git",
      "--exclude=.next",
      "--exclude=.omo",
      "--exclude=.codegraph",
      "--exclude=.playwright-mcp",
      "--exclude=.supabase",
      "--exclude=node_modules",
      "--exclude=supabase/.temp",
      "--exclude=.env*",
      `${repoRoot}/`,
      `${tempRoot}/`,
    ],
    60_000,
  )
  if (result.exitCode !== 0) throw new Error("Isolated Next workspace copy failed")
}

export function pickEnvironment(keys) {
  const env = {}
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Missing required child environment: ${key}`)
    }
    env[key] = value
  }
  return env
}

export async function removeOwnedTemp(tempRoot) {
  const realPrefix = `${await realpath(os.tmpdir())}${path.sep}`
  const resolved = await realpath(tempRoot)
  if (
    !resolved.startsWith(realPrefix) ||
    !path.basename(resolved).startsWith("spolink-task9-next-")
  ) {
    throw new Error("Refusing to remove an unowned Next temp directory")
  }
  await rm(resolved, { force: true, recursive: true })
}

function runBuffered(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer)
      resolve({ exitCode: exitCode ?? 1, signal, stderr, stdout })
    })
  })
}
