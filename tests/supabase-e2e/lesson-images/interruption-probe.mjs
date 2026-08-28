#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { readGuardedLocalStatus } from "../local-status.mjs"

const EVIDENCE_DIR = ".omo/evidence/lesson-image-upload/task-9"
const signal = readSignal(process.argv)
const outputName = signal === "SIGINT" ? "interruption-sigint.json" : "interruption-sigterm.json"
const expectedExitCode = signal === "SIGINT" ? 130 : 143

await mkdir(EVIDENCE_DIR, { mode: 0o700, recursive: true })
await chmod(EVIDENCE_DIR, 0o700)
const before = await snapshotOwnedState()
const result = await runSignalProbe(signal)
const after = await snapshotOwnedState()
const checks = {
  exitWasNonzero: result.exitCode !== 0,
  noFocusedRunner: after.focusedRunnerCount === before.focusedRunnerCount,
  noOwnedNextPorts: sameValues(after.ownedNextPorts, before.ownedNextPorts),
  noOwnedTemp: sameValues(after.ownedTempRoots, before.ownedTempRoots),
  noSuiteLock: after.suiteLock === before.suiteLock,
  port3000Preserved: sameValues(after.port3000Pids, before.port3000Pids),
  runtimePreserved: after.guardedRuntimePresent === before.guardedRuntimePresent,
  signalDerivedExit: result.killDelivered && result.exitCode === expectedExitCode,
  stopSignalRecorded: result.stopSignal === signal,
}
const artifact = {
  checks,
  cleanup: {
    authUsers: 0,
    databaseRows: 0,
    lingeringFocusedRunners: after.focusedRunnerCount - before.focusedRunnerCount,
    lingeringOwnedNextPorts: difference(after.ownedNextPorts, before.ownedNextPorts).length,
    lingeringOwnedTempRoots: difference(after.ownedTempRoots, before.ownedTempRoots).length,
    storageObjects: 0,
    suiteLockDelta: Number(after.suiteLock) - Number(before.suiteLock),
  },
  exitCode: result.exitCode,
  expectedExitCode,
  processSignal: result.processSignal,
  rawRedacted: {
    stderrBytes: Buffer.byteLength(result.stderr),
    stderrSha256: sha256(result.stderr),
    stdoutLines: result.stdout.split(/\r?\n/u).filter((line) => line.startsWith("WORKING:")),
    stdoutSha256: sha256(result.stdout),
  },
  redaction: "allowlisted WORKING lines and byte hashes only; no environment or identities",
  requestedSignal: signal,
  stopSignal: result.stopSignal,
  verdict: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
}
const outputPath = path.join(EVIDENCE_DIR, outputName)
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
await chmod(outputPath, 0o600)
assert.equal(artifact.verdict, "PASS", JSON.stringify(checks))
console.log(`${outputName}: PASS exit=${result.exitCode} cleanup=0`)

function runSignalProbe(stopSignal) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["tests/supabase-e2e/lesson-images/run-focused.mjs", "--label", "interruption-probe"],
      {
        cwd: process.cwd(),
        env: { ...process.env, SPOLINK_TASK9_HOLD_BEFORE_SUITE_MS: "60000" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )
    let stdout = ""
    let stderr = ""
    let sent = false
    let killDelivered = false
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error("Focused interruption probe timed out"))
    }, 120_000)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      if (!sent && stdout.includes("WORKING: running focused lesson-image live suite")) {
        sent = true
        killDelivered = child.kill(stopSignal)
      }
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("close", (exitCode, processSignal) => {
      clearTimeout(timeout)
      if (!sent) {
        reject(new Error("Focused interruption probe never reached the hold barrier"))
        return
      }
      resolve({
        exitCode: exitCode ?? 1,
        killDelivered,
        processSignal,
        stderr,
        stdout,
        stopSignal,
      })
    })
  })
}

async function snapshotOwnedState() {
  const [guardedRuntimePresent, ownedTempRoots, suiteLock] = await Promise.all([
    guardedRuntimeIsPresent(),
    readOwnedTempRoots(),
    pathExists(path.join(EVIDENCE_DIR, "suite.lock")),
  ])
  const processes = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
  assert.equal(processes.status, 0)
  return {
    focusedRunnerCount: processes.stdout
      .split(/\r?\n/u)
      .filter((line) => line.includes("lesson-images/run-focused.mjs")).length,
    guardedRuntimePresent,
    ownedNextPorts: listeningPorts().filter((port) => port >= 3400 && port < 3600),
    ownedTempRoots,
    port3000Pids: listeningPids(3000),
    suiteLock,
  }
}

async function guardedRuntimeIsPresent() {
  try {
    await readGuardedLocalStatus()
    return true
  } catch (error) {
    if (error?.code === "supabase_not_running") return false
    throw error
  }
}

async function readOwnedTempRoots() {
  return (await readdir(os.tmpdir()))
    .filter((name) => name.startsWith("spolink-task9-next-"))
    .sort()
}

function listeningPorts() {
  const result = spawnSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { encoding: "utf8" })
  if (result.status !== 0 && result.status !== 1)
    throw new Error("Unable to inspect listening ports")
  return [
    ...new Set(
      result.stdout
        .matchAll(/TCP\s+(?:127\.0\.0\.1|\*|\[::1\]):([0-9]+)\s+\(LISTEN\)/gu)
        .map((match) => Number(match[1])),
    ),
  ].sort((left, right) => left - right)
}

function listeningPids(port) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8",
  })
  if (result.status !== 0 && result.status !== 1) throw new Error(`Unable to inspect port ${port}`)
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(Number)
    .sort((left, right) => left - right)
}

async function pathExists(value) {
  try {
    await stat(value)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

function difference(after, before) {
  const baseline = new Set(before)
  return after.filter((value) => !baseline.has(value))
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function readSignal(argv) {
  const index = argv.indexOf("--signal")
  const value = index >= 0 ? argv[index + 1] : null
  if (!["SIGINT", "SIGTERM"].includes(value)) {
    throw new Error("Interruption probe requires --signal SIGINT or SIGTERM")
  }
  return value
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
