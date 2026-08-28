import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { promisify } from "node:util"
import {
  collectLearnerReservationSourceHashes,
  learnerReservationSourceFiles,
} from "./auth-ui-e2e/learner-reservations-source-files.mjs"

const specPath = "tests/auth-ui-e2e/learner-reservations.spec.ts"
const runFile = promisify(execFile)

test("Playwright discovers learner reservation coverage across all three projects", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "spolink-reservation-list-"))
  try {
    const { stdout } = await runFile(
      "corepack",
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config=playwright.auth.config.ts",
        specPath,
        "--list",
      ],
      {
        env: { ...process.env, SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: outputDir },
      },
    )
    const discovered = stdout
      .split("\n")
      .filter((line) => line.includes("learner-reservations.spec.ts"))
    assert.equal(discovered.length, 6)
    for (const project of ["desktop-chromium", "mobile-chromium", "tablet-chromium"]) {
      assert.equal(discovered.filter((line) => line.includes(`[${project}]`)).length, 2)
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true })
  }
})

test("learner reservation source hashes reject an omitted 10C helper", async () => {
  const hashes = await collectLearnerReservationSourceHashes()
  assert.deepEqual(Object.keys(hashes), learnerReservationSourceFiles)
  const omitted = learnerReservationSourceFiles.filter(
    (file) => file !== "tests/auth-ui-e2e/learner-reservations-scenario.ts",
  )
  await assert.rejects(() => collectLearnerReservationSourceHashes(omitted), /missing.*scenario/iu)
})

test("learner reservation publication preserves a coherent prior set when a second run is incomplete", async () => {
  const { publishLearnerReservationEvidence } = await import(
    "./auth-ui-e2e/learner-reservations-evidence.mjs"
  )
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-task6-publication-test-"))
  const outputPath = path.join(root, "focused-summary.json")
  const visualDir = path.join(root, "screenshots")
  const firstStage = path.join(root, "first-stage")
  const secondStage = path.join(root, "second-stage")
  const firstSummaryPath = path.join(root, "first-summary.json")
  const secondSummaryPath = path.join(root, "second-summary.json")
  try {
    // Given: one fully staged run is published as the coherent baseline.
    const first = await createStagedPublication(firstStage, 1)
    await writeJson(firstSummaryPath, validFocusedSummary(first))
    await publishLearnerReservationEvidence({
      outputPath,
      stagedScreenshotsDir: firstStage,
      stagedSummaryPath: firstSummaryPath,
      visualDir,
    })
    const before = await snapshotPublication(outputPath, visualDir)

    // When: a clean second run has a valid summary but is missing one staged screenshot.
    const second = await createStagedPublication(secondStage, 2)
    await rm(path.join(secondStage, "completion-success-1280.png"))
    await writeJson(secondSummaryPath, validFocusedSummary(second))

    // Then: publication fails before replacing any byte from the prior coherent set.
    await assert.rejects(
      () =>
        publishLearnerReservationEvidence({
          outputPath,
          stagedScreenshotsDir: secondStage,
          stagedSummaryPath: secondSummaryPath,
          visualDir,
        }),
      /screenshot|publication|inventory/iu,
    )
    assert.deepEqual(await snapshotPublication(outputPath, visualDir), before)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

const screenshotNames = [
  "completion-success-390.png",
  "completion-recovery-390.png",
  "completion-success-768.png",
  "completion-recovery-768.png",
  "completion-success-1280.png",
  "completion-recovery-1280.png",
]

async function createStagedPublication(directory, generation) {
  await mkdir(directory, { mode: 0o700 })
  const screenshots = []
  for (const name of screenshotNames) {
    const width = Number(name.match(/(390|768|1280)\.png$/u)?.[1])
    const height = width === 390 ? 844 : 900
    const bytes = fakePng(width, height, generation)
    await writeFile(path.join(directory, name), bytes, { mode: 0o600 })
    screenshots.push({
      bytes: bytes.byteLength,
      height,
      name,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width,
    })
  }
  return screenshots
}

function fakePng(width, height, generation) {
  const bytes = Buffer.alloc(32, generation)
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function validFocusedSummary(screenshots, runId = "contract-run") {
  const projectWidths = [
    ["mobile-chromium", 390],
    ["tablet-chromium", 768],
    ["desktop-chromium", 1280],
  ]
  return {
    browserReceipts: projectWidths.map(([project, width]) => ({
      browserDiagnostics: cleanBrowserDiagnostics(),
      cleanup: "completed",
      download: { bytes: 1, sha256: "1".repeat(64) },
      forbiddenRequestCount: 0,
      phases: [],
      project,
      screenshots: screenshots
        .filter((item) => item.width === width)
        .map((item) => ({
          ...item,
          state: item.name.includes("success") ? "success" : "recovery",
        })),
    })),
    exitCode: 0,
    mode: "confirmation-off",
    projects: ["mobile-chromium", "tablet-chromium", "desktop-chromium"],
    rawOutput: { removed: true, retained: false },
    redaction: "identifiers-and-secrets-omitted",
    resultHash: "0".repeat(64),
    runId,
    schemaVersion: 2,
    screenshots,
    signal: null,
    sourceHashes: { "tests/learner-reservations-e2e-contract.test.mjs": "2".repeat(64) },
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

async function snapshotPublication(outputPath, visualDir) {
  return {
    screenshots: await Promise.all(
      screenshotNames.map(async (name) => [
        name,
        await readFile(path.join(visualDir, name), "hex"),
      ]),
    ),
    summary: await readFile(outputPath, "hex"),
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
