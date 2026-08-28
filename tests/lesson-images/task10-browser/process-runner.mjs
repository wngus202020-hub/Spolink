import assert from "node:assert/strict"
import { spawn } from "node:child_process"

import { redactProcessOutput } from "./private-json.mjs"

export function createProcessRunner({ repoRoot, writePrivateJson }) {
  const activeChildren = new Set()
  const commandResults = []
  let interrupted = false

  const signalHandler = () => {
    interrupted = true
    for (const child of activeChildren) child.kill("SIGTERM")
  }

  return {
    commandResults,
    disposeSignals() {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.removeListener(signal, signalHandler)
      }
    },
    installSignals() {
      for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        process.on(signal, signalHandler)
      }
    },
    interrupted: () => interrupted,
    async runBounded({ command, env = {}, label, timeoutMs }) {
      const [executable, ...args] = command
      const child = spawn(executable, args, {
        cwd: repoRoot,
        detached: true,
        env: { ...process.env, ...env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      })
      activeChildren.add(child)
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk) => {
        stdout = boundedAppend(stdout, chunk)
      })
      child.stderr.on("data", (chunk) => {
        stderr = boundedAppend(stderr, chunk)
      })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, timeoutMs)
      const result = await new Promise((resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code, signal) => resolve({ code, signal }))
      })
      clearTimeout(timer)
      activeChildren.delete(child)
      const receipt = {
        ...result,
        label,
        stderr: redactProcessOutput(stderr),
        stdout: redactProcessOutput(stdout),
        timedOut,
      }
      commandResults.push(receipt)
      await writePrivateJson(`${label}.json`, receipt)
      assert.equal(timedOut, false, `${label} timed out`)
      assert.equal(result.code, 0, `${label} failed: ${receipt.stderr.slice(-1_000)}`)
    },
  }
}

export function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited ${code}: ${stderr}`))
    })
  })
}

function boundedAppend(current, chunk) {
  return `${current}${String(chunk)}`.slice(-100_000)
}
