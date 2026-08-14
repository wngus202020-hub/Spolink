import { spawn } from "node:child_process"
import process from "node:process"

import { createDockerEnv, createSupabaseSealedEnv } from "./env.mjs"
import { signalProcessGroup } from "./utils.mjs"

export function buildDockerSpawn(args, { env = process.env } = {}) {
  return {
    command: "docker",
    args,
    options: { shell: false, env: createDockerEnv(env) },
    timeoutMs: 15_000,
  }
}

export function buildSupabaseSpawn(args, { repoRoot = process.cwd(), env = process.env } = {}) {
  return {
    command: "corepack",
    args: ["pnpm", "exec", "supabase", ...args],
    options: {
      cwd: repoRoot,
      shell: false,
      env: createSupabaseSealedEnv(env),
    },
    timeoutMs: 180_000,
  }
}

export async function runRequired(spawnRunner, spec) {
  const result = await spawnRunner(spec)
  if (result.exitCode !== 0) {
    throw new Error(`${spec.command} ${spec.args.join(" ")} failed with exit ${result.exitCode}`)
  }
  return result
}

export async function runSpawn(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { ...spec.options, detached: true })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    let killTimer
    const timeout = setTimeout(() => {
      timedOut = true
      signalProcessGroup(child, "SIGTERM")
      killTimer = setTimeout(() => signalProcessGroup(child, "SIGKILL"), 2_000)
      killTimer.unref()
    }, spec.timeoutMs ?? 180_000)
    timeout.unref()
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      if (error.code === "ENOENT") {
        resolve({ exitCode: 127, stdout, stderr: error.message })
        return
      }
      reject(error)
    })
    child.once("close", (exitCode) => {
      clearTimeout(timeout)
      clearTimeout(killTimer)
      resolve({ exitCode: timedOut ? 124 : (exitCode ?? 1), stdout, stderr })
    })
  })
}
