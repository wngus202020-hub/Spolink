import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { publishLearnerReservationEvidence } from "./auth-ui-e2e/learner-reservations-evidence.mjs"

export const screenshotNames = [
  "completion-success-390.png",
  "completion-recovery-390.png",
  "completion-success-768.png",
  "completion-recovery-768.png",
  "completion-success-1280.png",
  "completion-recovery-1280.png",
]
const projects = ["mobile-chromium", "tablet-chromium", "desktop-chromium"]

export async function createFixture() {
  return fixturePaths(await mkdtemp(path.join(os.tmpdir(), "spolink-atomic-publication-")))
}

export function fixturePaths(root) {
  return {
    current: path.join(root, "current"),
    outputPath: path.join(root, "focused-summary.json"),
    root,
    versionsRoot: path.join(root, "versions"),
    visualDir: path.join(root, "screenshots"),
  }
}

export async function stageGeneration(root, name, generation) {
  const stageRoot = path.join(root, `${name}-stage`)
  const screenshotsDir = path.join(stageRoot, "screenshots")
  const summaryPath = path.join(stageRoot, "focused-summary.json")
  await mkdir(screenshotsDir, { mode: 0o700, recursive: true })
  const screenshots = []
  for (const screenshotName of screenshotNames) {
    const width = Number(screenshotName.match(/(390|768|1280)\.png$/u)?.[1])
    const height = width === 390 ? 844 : 900
    const bytes = fakePng(width, height, generation)
    await writeFile(path.join(screenshotsDir, screenshotName), bytes, { mode: 0o600 })
    screenshots.push({
      bytes: bytes.byteLength,
      height,
      name: screenshotName,
      sha256: sha256(bytes),
      width,
    })
  }
  const runId = `${name}-run`
  const summary = validFocusedSummary(runId, screenshots)
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 })
  return { runId, screenshotsDir, summary, summaryPath }
}

export async function installLegacyCanonical(fixture, staged) {
  await mkdir(fixture.visualDir, { mode: 0o700 })
  for (const name of screenshotNames) {
    await writeFile(
      path.join(fixture.visualDir, name),
      await readFile(path.join(staged.screenshotsDir, name)),
      { mode: 0o600 },
    )
  }
  await writeFile(fixture.outputPath, `${JSON.stringify(staged.summary, null, 2)}\n`, {
    mode: 0o600,
  })
}

export async function publish(fixture, staged, publicationHooks = undefined) {
  return await publishLearnerReservationEvidence({
    outputPath: fixture.outputPath,
    publicationHooks,
    stagedScreenshotsDir: staged.screenshotsDir,
    stagedSummaryPath: staged.summaryPath,
    visualDir: fixture.visualDir,
  })
}

export async function spawnInterruptionChild(fixture, staged, phase) {
  return await new Promise((resolve, reject) => {
    const childPath = new URL(
      "./learner-reservations-evidence-publication-child.mjs",
      import.meta.url,
    ).pathname
    const child = spawn(process.execPath, [childPath], {
      env: {
        ...process.env,
        SPOLINK_PUBLICATION_PHASE: phase,
        SPOLINK_PUBLICATION_ROOT: fixture.root,
        SPOLINK_PUBLICATION_RUN_ID: staged.runId,
        SPOLINK_PUBLICATION_SCREENSHOTS: staged.screenshotsDir,
        SPOLINK_PUBLICATION_SUMMARY: staged.summaryPath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal, stderr }))
  })
}

export async function readCanonical(fixture) {
  const summary = JSON.parse(await readFile(fixture.outputPath, "utf8"))
  const hashes = {}
  for (const name of screenshotNames) {
    hashes[name] = sha256(await readFile(path.join(fixture.visualDir, name)))
  }
  return { hashes, runId: summary.runId, summary }
}

export async function readViaCurrent(fixture) {
  const bundle = await realpath(fixture.current)
  const summary = JSON.parse(await readFile(path.join(bundle, "focused-summary.json"), "utf8"))
  const hashes = {}
  for (const name of screenshotNames) {
    hashes[name] = sha256(await readFile(path.join(bundle, "screenshots", name)))
  }
  return { hashes, runId: summary.runId, summary }
}

export function assertSnapshotCoherent(snapshot) {
  assert.equal(snapshot.summary.runId, snapshot.runId)
  assert.deepEqual(
    snapshot.hashes,
    Object.fromEntries(snapshot.summary.screenshots.map((item) => [item.name, item.sha256])),
  )
}

export async function assertCanonicalTopology(fixture, runId) {
  assert.equal(await readlink(fixture.current), path.join("versions", runId))
  assert.equal(await readlink(fixture.outputPath), path.join("current", "focused-summary.json"))
  for (const name of screenshotNames) {
    assert.equal(
      await readlink(path.join(fixture.visualDir, name)),
      path.join("..", "current", "screenshots", name),
    )
  }
  assert.equal(
    await realpath(fixture.current),
    await realpath(path.join(fixture.versionsRoot, runId)),
  )
}

export async function assertSecureModes(fixture) {
  assert.equal((await lstat(fixture.versionsRoot)).mode & 0o777, 0o700)
  const bundle = await realpath(fixture.current)
  assert.equal((await lstat(bundle)).mode & 0o777, 0o700)
  assert.equal((await lstat(path.join(bundle, "screenshots"))).mode & 0o777, 0o700)
  assert.equal((await lstat(path.join(bundle, "focused-summary.json"))).mode & 0o777, 0o600)
  assert.equal((await lstat(path.join(bundle, "source-run-manifest.json"))).mode & 0o777, 0o600)
  for (const name of screenshotNames) {
    assert.equal((await lstat(path.join(bundle, "screenshots", name))).mode & 0o777, 0o600)
  }
}

function fakePng(width, height, generation) {
  const bytes = Buffer.alloc(32, generation)
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function validFocusedSummary(runId, screenshots) {
  return {
    browserReceipts: projects.map((project, index) => ({
      browserDiagnostics: cleanBrowserDiagnostics(),
      cleanup: "completed",
      download: { bytes: 1, sha256: "1".repeat(64) },
      forbiddenRequestCount: 0,
      phases: [],
      project,
      screenshots: screenshots.slice(index * 2, index * 2 + 2).map((item) => ({
        ...item,
        state: item.name.includes("success") ? "success" : "recovery",
      })),
    })),
    exitCode: 0,
    mode: "confirmation-off",
    projects,
    rawOutput: { removed: true, retained: false },
    redaction: "identifiers-and-secrets-omitted",
    resultHash: "0".repeat(64),
    runId,
    schemaVersion: 2,
    screenshots,
    signal: null,
    sourceHashes: { "tests/example.mjs": "2".repeat(64) },
    specs: ["tests/auth-ui-e2e/learner-reservations.spec.ts"],
    verdict: "APPROVE",
  }
}

function cleanBrowserDiagnostics() {
  return {
    expectedHttpFailures: [
      { count: 3, routeCategory: "completion-page", status: 404 },
      { count: 1, routeCategory: "reservation-detail-page", status: 404 },
    ],
    expectedNavigationAbortCount: 1,
    consoleWarningCount: 0,
    unexpected: { consoleError: 0, httpResponse: 0, pageError: 0, requestFailed: 0 },
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
