import assert from "node:assert/strict"
import { access, stat } from "node:fs/promises"
import path from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { spawnBuffered } from "./fake-lifecycle-harness.mjs"
import { classifyMypageDocumentDiagnosis } from "./lifecycle.mjs"
import { runBuffered, stopActiveCommand, trackActiveCommand } from "./process.mjs"
import { createBoundedChildOutputCapture, prepareRawPlaywrightOutputDir } from "./raw-output.mjs"

test("Next output drainage is bounded, redacted, hash-backed, and removes raw output", async () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const capture = await createBoundedChildOutputCapture({ retainRawOutput: false })
  const rawDir = capture.rawDir
  capture.attach({ stderr, stdout })

  stdout.end(`${"x".repeat(128_000)} learner@example.test 11111111-1111-4111-8111-111111111111`)
  stderr.end("postgresql://user:secret@127.0.0.1:5432/db /tmp/private-output")
  const summary = await capture.settle()

  assert.equal(summary.stdout.bytes > 128_000, true)
  assert.equal(summary.stderr.bytes > 0, true)
  assert.match(summary.stdout.sha256, /^[a-f0-9]{64}$/u)
  assert.match(summary.stderr.sha256, /^[a-f0-9]{64}$/u)
  assert.equal(summary.stdout.tail.length <= 4_096, true)
  assert.doesNotMatch(JSON.stringify(summary), /learner@example|11111111|postgresql:|\/tmp\//u)
  assert.equal((await stat(path.join(rawDir, "next-stdout.log"))).mode & 0o777, 0o600)
  assert.equal((await stat(path.join(rawDir, "next-stderr.log"))).mode & 0o777, 0o600)

  await capture.cleanup()
  await assert.rejects(() => access(rawDir), /ENOENT/u)
})

test("raw output cleanup tolerates consumer recreation only below its registered parent", async () => {
  const output = await prepareRawPlaywrightOutputDir()
  const { rm, mkdir: makeDirectory } = await import("node:fs/promises")
  await rm(output.dir, { recursive: true })
  await makeDirectory(output.dir, { mode: 0o700 })
  await output.cleanup()
  await assert.rejects(() => access(output.dir), /ENOENT/u)
})

test("My Page document diagnosis distinguishes failed documents and wrong profiles", () => {
  assert.equal(
    classifyMypageDocumentDiagnosis({
      documentFinished: false,
      headingMatched: false,
      profileMatched: false,
      status: 500,
    }),
    "server-boundary",
  )
  assert.equal(
    classifyMypageDocumentDiagnosis({
      documentFinished: true,
      headingMatched: true,
      profileMatched: false,
      status: 200,
    }),
    "session-profile",
  )
  assert.equal(
    classifyMypageDocumentDiagnosis({
      documentFinished: true,
      headingMatched: true,
      profileMatched: true,
      status: 200,
    }),
    "healthy",
  )
})

test("baseline: stopping a tracked command leaves an unrelated child running", async () => {
  const command = ["-e", "setInterval(() => {}, 1000)"]
  const ownedChild = spawnBuffered(process.execPath, command)
  const unrelatedChild = spawnBuffered(process.execPath, command)
  const tracked = trackActiveCommand({
    kill: (signal) => process.kill(ownedChild.pid, signal),
    once: () => {},
    pid: ownedChild.pid,
  })
  tracked.closed = ownedChild.result
  try {
    await stopActiveCommand(tracked)
    assert.equal((await ownedChild.result).signal, "SIGTERM")
    assert.doesNotThrow(() => process.kill(unrelatedChild.pid, 0))
  } finally {
    process.kill(unrelatedChild.pid, "SIGTERM")
    await unrelatedChild.result
  }
})

test("runBuffered force-stops an owned child that ignores SIGTERM", async () => {
  let child
  const run = runBuffered(
    process.execPath,
    ["--input-type=module", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    {
      killAfterMs: 50,
      onChild: (spawned) => {
        child = spawned
      },
      timeoutMs: 50,
    },
  )
  try {
    const result = await Promise.race([
      run,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("runBuffered stayed pending")), 500),
      ),
    ])
    assert.equal(result.signal, "SIGKILL")
  } finally {
    child?.kill("SIGKILL")
  }
})

test("fake lifecycle spawnBuffered force-stops an owned child that ignores SIGTERM", async () => {
  const child = spawnBuffered(
    process.execPath,
    ["--input-type=module", "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
    { killAfterMs: 50, timeoutMs: 50 },
  )
  try {
    const result = await Promise.race([
      child.result,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("spawnBuffered stayed pending")), 500),
      ),
    ])
    assert.equal(result.signal, "SIGKILL")
  } finally {
    await killIfStillRunning(child.pid)
  }
})

test("stopChild does not keep the runner alive after the owned child closes", async () => {
  const processModuleUrl = pathToFileURL(
    path.join(process.cwd(), "tests/auth-ui-e2e/process.mjs"),
  ).href
  const source = `
    import { spawn } from "node:child_process";
    import { stopChild } from ${JSON.stringify(processModuleUrl)};
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    await stopChild(child);
  `
  const result = await runBuffered(process.execPath, ["--input-type=module", "-e", source], {
    killAfterMs: 100,
    timeoutMs: 1_000,
  })

  assert.equal(result.exitCode, 0, "stopChild left a timer handle that blocked natural exit")
})

async function killIfStillRunning(pid) {
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (error?.code === "ESRCH") return
    throw error
  }
}
