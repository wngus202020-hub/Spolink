import { spawn } from "node:child_process"
import { constants as osConstants } from "node:os"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { createDockerEnv, createSupabaseSealedEnv } from "./env.mjs"
import { createOutputTail } from "./output-redaction.mjs"

const supervisorPath = fileURLToPath(new URL("./spawn-supervisor.mjs", import.meta.url))

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
    preserveStdoutOnSuccess: isStatusJsonCommand(args),
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

export function runSpawn(spec) {
  if (process.platform === "win32") {
    return Promise.reject(new Error("Persistent spawn supervision requires POSIX process groups"))
  }
  if (spec.options?.shell !== false) {
    return Promise.reject(new Error("Supervised commands require shell: false"))
  }
  return new Promise((resolve, reject) => {
    const stdout = createOutputTail({
      preserveOperationalOutput: spec.preserveStdoutOnSuccess === true,
    })
    const stderr = createOutputTail()
    const child = spawn(process.execPath, [supervisorPath, "--", spec.command, ...spec.args], {
      ...spec.options,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let timedOut = false
    let settled = false
    let termTimer
    let killTimer
    const timeout = setTimeout(beginTimeout, spec.timeoutMs ?? 180_000)
    timeout.unref()
    child.stdout?.on("data", stdout.append)
    child.stderr?.on("data", stderr.append)
    child.once("error", finishError)
    child.once("close", finishClose)

    function beginTimeout() {
      timedOut = true
      if (!signalGroup("SIGTERM")) return
      termTimer = setTimeout(() => {
        if (!signalGroup("SIGKILL")) return
        killTimer = setTimeout(
          () => finishError(new Error("Supervisor did not exit after SIGKILL")),
          500,
        )
        killTimer.unref()
      }, 2_000)
      termTimer.unref()
    }

    function signalGroup(signal) {
      if (!isChildIdentityAlive(child)) return false
      try {
        process.kill(-child.pid, signal)
        return true
      } catch (error) {
        if (error?.code === "ESRCH") return false
        finishError(error)
        return false
      }
    }

    function finishClose(code, signal) {
      if (settled) return
      settled = true
      clearTimers()
      const exitCode = timedOut ? 124 : (code ?? signalExitCode(signal))
      const result = {
        exitCode,
        stdout: stdout.value(spec.preserveStdoutOnSuccess === true && exitCode === 0),
        stderr: stderr.value(),
      }
      if (!timedOut && signal) result.signal = signal
      resolve(result)
    }

    function finishError(error) {
      if (settled) return
      settled = true
      clearTimers()
      reject(error)
    }

    function clearTimers() {
      clearTimeout(timeout)
      clearTimeout(termTimer)
      clearTimeout(killTimer)
      child.stdout?.off("data", stdout.append)
      child.stderr?.off("data", stderr.append)
      child.removeListener("error", finishError)
      child.removeListener("close", finishClose)
    }
  })
}

function isChildIdentityAlive(child) {
  return Boolean(child.pid && child.exitCode === null && child.signalCode === null)
}

function signalExitCode(signal) {
  return signal ? 128 + (osConstants.signals[signal] ?? 0) : 1
}

function isStatusJsonCommand(args) {
  if (args[0] !== "status") return false
  return args.some((arg, index) => ["-o", "--output"].includes(arg) && args[index + 1] === "json")
}
