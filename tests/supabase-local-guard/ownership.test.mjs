import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createRuntimeReceipt,
  runReset,
  runStart,
  runStop,
  runtimeLockPath,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"
import {
  baseEnv,
  copyConfigInto,
  deferred,
  desktopSpawnRunner,
  localStatusJson,
  waitForFile,
} from "./helpers.mjs"

test("rejects wrong run before destructive reset spawns", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    await copyConfigInto(dir)
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-current",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
      }),
    )
    await assert.rejects(
      runReset({
        repoRoot: dir,
        env: baseEnv,
        runId: "run-stale",
        receiptPath,
        spawnRunner: async (spec) => {
          calls.push(spec)
          return { exitCode: 0, stdout: "", stderr: "" }
        },
      }),
      /stale/i,
    )
    assert.equal(calls.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("failed start with preexisting runtime state does not authorize later deletion", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  const stateDir = path.join(dir, ".supabase")
  const sentinel = path.join(stateDir, "user-owned")
  try {
    await mkdir(stateDir)
    await writeFile(sentinel, "preserve")
    const receiptPath = path.join(dir, "runtime.json")
    await assert.rejects(
      runStart({
        repoRoot: dir,
        env: baseEnv,
        receiptPath,
        spawnRunner: desktopSpawnRunner(calls),
      }),
      /runtime state is not owned/i,
    )
    await assert.rejects(
      runStop({ repoRoot: dir, env: baseEnv, receiptPath, spawnRunner: desktopSpawnRunner(calls) }),
      /ENOENT|receipt/i,
    )
    assert.equal(await readFile(sentinel, "utf8"), "preserve")
    assert.equal(
      calls.some((call) => call.command === "corepack" && call.args.at(-1) === "start"),
      false,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("dead task-owned start lock recovers orphaned Supabase temp and branches dirs", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    await copyConfigInto(dir)
    const receiptPath = path.join(dir, ".omo/evidence/runtime.json")
    const lockPath = runtimeLockPath(receiptPath)
    await mkdir(path.dirname(lockPath), { recursive: true })
    await mkdir(path.join(dir, "supabase/.temp"), { recursive: true })
    await mkdir(path.join(dir, "supabase/.branches"), { recursive: true })
    await writeFile(path.join(dir, "supabase/.temp/orphan"), "temp")
    await writeFile(path.join(dir, "supabase/.branches/orphan"), "branch")
    await writeFile(
      lockPath,
      JSON.stringify({ pid: await completedChildPid(), createdAt: new Date().toISOString() }),
      { mode: 0o600 },
    )

    const result = await runStart({
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
      spawnRunner: desktopSpawnRunner(calls),
    })

    assert.equal(result.runId.startsWith("spolink-"), true)
    await assert.rejects(access(path.join(dir, "supabase/.temp")), /ENOENT/)
    await assert.rejects(access(path.join(dir, "supabase/.branches")), /ENOENT/)
    assert.equal(
      calls.some((call) => call.command === "corepack" && call.args.at(-1) === "start"),
      true,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("live start lock preserves orphan-looking Supabase temp and branches dirs", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    await copyConfigInto(dir)
    const receiptPath = path.join(dir, ".omo/evidence/runtime.json")
    const lockPath = runtimeLockPath(receiptPath)
    await mkdir(path.dirname(lockPath), { recursive: true })
    await mkdir(path.join(dir, "supabase/.temp"), { recursive: true })
    await mkdir(path.join(dir, "supabase/.branches"), { recursive: true })
    await writeFile(path.join(dir, "supabase/.temp/live"), "preserve")
    await writeFile(path.join(dir, "supabase/.branches/live"), "preserve")
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      { mode: 0o600 },
    )

    await assert.rejects(
      runStart({
        repoRoot: dir,
        env: baseEnv,
        receiptPath,
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        spawnRunner: desktopSpawnRunner(calls),
      }),
      /in progress/i,
    )

    assert.equal(await readFile(path.join(dir, "supabase/.temp/live"), "utf8"), "preserve")
    assert.equal(await readFile(path.join(dir, "supabase/.branches/live"), "utf8"), "preserve")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("orphan-looking Supabase temp and branches dirs without a stale lock stay unowned", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    await copyConfigInto(dir)
    await mkdir(path.join(dir, "supabase/.temp"), { recursive: true })
    await mkdir(path.join(dir, "supabase/.branches"), { recursive: true })
    await writeFile(path.join(dir, "supabase/.temp/unowned"), "preserve")
    await writeFile(path.join(dir, "supabase/.branches/unowned"), "preserve")
    const receiptPath = path.join(dir, ".omo/evidence/runtime.json")

    await assert.rejects(
      runStart({
        repoRoot: dir,
        env: baseEnv,
        receiptPath,
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        spawnRunner: desktopSpawnRunner(calls),
      }),
      /runtime state is not owned/i,
    )

    assert.equal(await readFile(path.join(dir, "supabase/.temp/unowned"), "utf8"), "preserve")
    assert.equal(await readFile(path.join(dir, "supabase/.branches/unowned"), "utf8"), "preserve")
    assert.equal(
      calls.some((call) => call.command === "corepack" && call.args.at(-1) === "start"),
      false,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("dead task-owned start lock does not authorize .supabase runtime cleanup", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    await copyConfigInto(dir)
    const stateDir = path.join(dir, ".supabase")
    const sentinel = path.join(stateDir, "user-owned")
    await mkdir(stateDir)
    await writeFile(sentinel, "preserve")
    const receiptPath = path.join(dir, ".omo/evidence/runtime.json")
    const lockPath = runtimeLockPath(receiptPath)
    await mkdir(path.dirname(lockPath), { recursive: true })
    await writeFile(
      lockPath,
      JSON.stringify({ pid: await completedChildPid(), createdAt: new Date().toISOString() }),
      { mode: 0o600 },
    )

    await assert.rejects(
      runStart({
        repoRoot: dir,
        env: baseEnv,
        receiptPath,
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        spawnRunner: desktopSpawnRunner(calls),
      }),
      /runtime state is not owned/i,
    )

    assert.equal(await readFile(sentinel, "utf8"), "preserve")
    assert.equal(
      calls.some((call) => call.command === "corepack" && call.args.at(-1) === "start"),
      false,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("stop deletes only explicitly current-run-owned runtime directories", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  const stateDir = path.join(dir, ".supabase")
  const sentinel = path.join(stateDir, "preserve")
  try {
    await mkdir(stateDir)
    await writeFile(sentinel, "owned-by-user")
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-empty",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
        ownedRuntimeDirs: { runId: "run-empty", paths: [] },
      }),
    )
    await runStop({
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      spawnRunner: desktopSpawnRunner(calls),
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
      portChecker: async () => true,
    })
    assert.equal(await readFile(sentinel, "utf8"), "owned-by-user")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("stale task-owned Docker receipt never quits a preexisting live daemon", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-stale-docker",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
        ownedRuntimeDirs: { runId: "run-stale-docker", paths: [] },
      }),
    )
    await assert.rejects(
      runStop({
        repoRoot: dir,
        env: baseEnv,
        receiptPath,
        spawnRunner: desktopSpawnRunner(calls),
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        portChecker: async () => true,
      }),
      /ownership proof/i,
    )
    assert.equal(
      calls.some((call) => call.command === "osascript"),
      false,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("custom receiptPath derives custom zero-resource path without workspace overwrite", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-custom-zero",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-started",
        dockerOwnershipProof: {
          runId: "run-custom-zero",
          initialDockerInfoExitCode: 1,
          action: "open -a Docker",
          daemonIdentity: {
            processName: "com.docker.backend",
            pid: 4242,
            startIdentity:
              "Thu Jul 16 09:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend",
          },
        },
        ownedRuntimeDirs: { runId: "run-custom-zero", paths: [] },
      }),
    )
    await runStop({
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      spawnRunner: desktopSpawnRunner(calls, {
        docker: (spec) =>
          spec.args[0] === "info" && !spec.args.includes("--format")
            ? { exitCode: 1, stdout: "", stderr: "stopped" }
            : null,
      }),
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
      portChecker: async () => true,
    })
    await access(path.join(dir, "runtime-zero-resources-supabase-auth-rls-e2e.json"))
    assert.equal(
      calls.some((call) => call.command === "osascript"),
      true,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("concurrent starts are rejected by a race-safe lifecycle lock", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  const receiptPath = path.join(dir, "runtime.json")
  const releaseStart = deferred()
  try {
    const startOptions = {
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
      spawnRunner: desktopSpawnRunner([], {
        corepack: async (spec) => {
          if (spec.args.at(-1) === "start") {
            await releaseStart.promise
            return { exitCode: 0, stdout: "", stderr: "" }
          }
          if (spec.args.includes("status"))
            return { exitCode: 0, stdout: localStatusJson(), stderr: "" }
          return null
        },
      }),
    }
    const firstStart = runStart(startOptions)
    await waitForFile(path.join(dir, "runtime-lock-supabase-auth-rls-e2e.lock"))
    await assert.rejects(runStart(startOptions), /in progress/i)
    releaseStart.resolve()
    await firstStart
  } finally {
    releaseStart.resolve()
    await rm(dir, { recursive: true, force: true })
  }
})

async function completedChildPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  const pid = child.pid
  assert.equal(typeof pid, "number")
  await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })
  await assert.rejects(
    Promise.resolve().then(() => process.kill(pid, 0)),
    /ESRCH/,
  )
  return pid
}
