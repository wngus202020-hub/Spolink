#!/usr/bin/env node
import { execFile, spawn } from "node:child_process"
import process from "node:process"

const separator = process.argv.indexOf("--")
if (process.platform === "win32" || separator < 0 || !process.argv[separator + 1]) {
  process.stderr.write("Persistent spawn supervision requires POSIX process groups\n")
  process.exit(125)
}

const command = process.argv[separator + 1]
const args = process.argv.slice(separator + 2)
let outcome = null
let finishing = false

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {})

await assertOwnProcessGroup()
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ["ignore", "pipe", "pipe"],
})
child.stdout?.pipe(process.stdout)
child.stderr?.pipe(process.stderr)
child.once("error", (error) => {
  if (error?.code === "ENOENT") {
    process.stderr.write(`${error.message}\n`)
    outcome = { code: 127, signal: null }
    void waitForDescendants()
    return
  }
  fail(error)
})
child.once("close", (code, signal) => {
  outcome ??= { code: code ?? 1, signal }
  void waitForDescendants()
})

async function assertOwnProcessGroup() {
  const rows = await readProcessGroups()
  const own = rows.find((row) => row.pid === process.pid)
  if (!own || own.pgid !== process.pid) {
    throw new Error("Spawn supervisor is not its persistent process-group leader")
  }
}

async function waitForDescendants() {
  if (!outcome || finishing) return
  finishing = true
  try {
    while (await hasGroupMember()) await delay(20)
    finish()
  } catch (error) {
    fail(error)
  }
}

async function hasGroupMember() {
  const rows = await readProcessGroups()
  return rows.some((row) => row.pgid === process.pid && row.pid !== process.pid)
}

function readProcessGroups() {
  return new Promise((resolve, reject) => {
    const probe = execFile(
      "/bin/ps",
      ["-axo", "pid=,pgid="],
      { encoding: "utf8", maxBuffer: 1_048_576 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(
          stdout.split("\n").flatMap((line) => {
            const match = line.match(/^\s*(\d+)\s+(\d+)\s*$/u)
            return match && Number(match[1]) !== probe.pid
              ? [{ pid: Number(match[1]), pgid: Number(match[2]) }]
              : []
          }),
        )
      },
    )
  })
}

function finish() {
  if (outcome.signal) {
    process.removeAllListeners(outcome.signal)
    process.kill(process.pid, outcome.signal)
    return
  }
  process.exit(outcome.code)
}

function fail(error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(125)
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
