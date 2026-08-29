import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  assertCoachDashboardEvidenceRedacted,
  readCoachDashboardEvidence,
  writeCoachDashboardEvidence,
} from "./coach-dashboard-evidence.mjs"
import {
  readCoachDashboardTask7Manifest,
  updateCoachDashboardTask7Manifest,
} from "./coach-dashboard-task7-manifest.mjs"
import { sha256 } from "./process.mjs"

const cleanFixture = {
  coachProfilesRemaining: 0,
  graphRowsRemaining: 0,
  profilesRemaining: 0,
  usersRemaining: 0,
}

test("evidence is private, self-hash verified, and contains no sensitive values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-dashboard-evidence-"))
  const fixturePath = path.join(root, "contract-evidence.json")
  try {
    await writeCoachDashboardEvidence(fixturePath, {
      epochHash: "a".repeat(64),
      fixtureCleanup: cleanFixture,
      verdict: "APPROVE",
    })
    const evidence = await readCoachDashboardEvidence(fixturePath)

    assert.equal((await stat(fixturePath)).mode & 0o777, 0o600)
    assert.equal(evidence.verdict, "APPROVE")
    assertCoachDashboardEvidenceRedacted(evidence)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("evidence writer rejects reporter output and stack-shaped fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-dashboard-evidence-"))
  const fixturePath = path.join(root, "raw-output-rejected.json")
  try {
    await assert.rejects(
      writeCoachDashboardEvidence(fixturePath, {
        failureDetails: "Running 1 test\nError stack\ntrace.zip\n/Users/private/source.ts",
        failureHash: "a".repeat(64),
        verdict: "REJECT",
      }),
      /raw output field/u,
    )
    await assert.rejects(
      writeCoachDashboardEvidence(fixturePath, {
        failureHash: "a".repeat(64),
        reporterOutput: "arbitrary reporter transcript",
        verdict: "REJECT",
      }),
      /raw output field|unexpected evidence field/u,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("task7 aggregate atomically rebinds a supported scenario rerun", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-coach-dashboard-task7-"))
  try {
    await writeScenario(root, "populated-navigation", "first")
    await writeScenario(root, "redirect-ownership", "first")
    const first = await updateCoachDashboardTask7Manifest({ root })
    assert.equal(first.verdict, "APPROVE")
    const verifiedFirst = await readCoachDashboardTask7Manifest({ root })
    const firstBinding = verifiedFirst.scenarios["populated-navigation"]

    await writeScenario(root, "populated-navigation", "second")
    const second = await updateCoachDashboardTask7Manifest({ root })
    const verifiedSecond = await readCoachDashboardTask7Manifest({ root })
    const secondBinding = verifiedSecond.scenarios["populated-navigation"]

    assert.notEqual(second.selfHash.value, first.selfHash.value)
    assert.notEqual(secondBinding.summary.sha256, firstBinding.summary.sha256)
    assert.notEqual(secondBinding.cleanupReceipt.sha256, firstBinding.cleanupReceipt.sha256)
    assert.notEqual(secondBinding.visual.sha256, firstBinding.visual.sha256)
    assert.equal(verifiedSecond.verdict, "APPROVE")
    assert.equal(
      (await stat(path.join(root, "task-7-coach-dashboard-screen.json"))).mode & 0o777,
      0o600,
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

async function writeScenario(root, scenario, revision) {
  const visualName = `coach-dashboard-${scenario}-desktop.png`
  const visualDirectory = path.join(root, `${scenario}-visual`)
  const visualPath = path.join(visualDirectory, visualName)
  const visualBytes = Buffer.from(`png-${scenario}-${revision}`)
  const cleanupName = `${scenario}.cleanup.json`
  await mkdir(visualDirectory, { mode: 0o700, recursive: true })
  await writeFile(visualPath, visualBytes, { mode: 0o600 })
  await writeFile(
    path.join(root, cleanupName),
    `${JSON.stringify({ revision, verdict: "APPROVE" })}\n`,
    { mode: 0o600 },
  )
  await writeCoachDashboardEvidence(path.join(root, `${scenario}.json`), {
    epochHash: "a".repeat(64),
    exitCode: 0,
    failureClass: null,
    failureHash: null,
    fixtureCleanup: cleanFixture,
    grepApplied: true,
    lifecycleCleanupReceipt: cleanupName,
    outputHash: sha256(revision),
    rawOutputCleanupHash: "b".repeat(64),
    scenario: `${scenario}:complete`,
    signal: null,
    specs: ["tests/auth-ui-e2e/coach-dashboard.spec.ts"],
    verdict: "APPROVE",
    visuals: {
      files: [
        {
          bytes: visualBytes.length,
          name: visualName,
          sha256: sha256(visualBytes),
        },
      ],
      verdict: "APPROVE",
    },
  })
}
