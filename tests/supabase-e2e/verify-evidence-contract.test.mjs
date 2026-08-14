import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createF4FinalFromPreflight } from "./verify-evidence/f4-final.mjs"
import { verifyEvidenceFile } from "./verify-evidence/records.mjs"
import {
  discoverTaskAttemptPaths,
  finalWavePathForTarget,
  verifyTaskTarget,
} from "./verify-evidence/targets.mjs"

const zeroSha = "0".repeat(64)

test("final-wave targets use plan-defined evidence paths", () => {
  assert.equal(
    finalWavePathForTarget("f1"),
    ".omo/evidence/f1-supabase-auth-rls-e2e-plan-compliance.md",
  )
  assert.equal(finalWavePathForTarget("f2"), ".omo/evidence/f2-supabase-auth-rls-e2e-review.md")
  assert.equal(finalWavePathForTarget("f3"), ".omo/evidence/f3-supabase-auth-rls-e2e-runtime-qa.md")
  assert.equal(finalWavePathForTarget("f4"), ".omo/evidence/f4-supabase-auth-rls-e2e-scope.md")
})

test("task verification sorts canonical before numeric resumes and requires latest approve", async () => {
  const fixture = await evidenceFixture()
  try {
    await writeAttempt(fixture, "task-1-supabase-auth-rls-e2e.log", "REJECT")
    await writeAttempt(fixture, "task-1-resume-1-supabase-auth-rls-e2e.log", "REJECT")
    await writeAttempt(fixture, "task-1-resume-2-supabase-auth-rls-e2e.log", "APPROVE")

    assert.deepEqual(await discoverTaskAttemptPaths(fixture.root, "task-1"), [
      ".omo/evidence/task-1-supabase-auth-rls-e2e.log",
      ".omo/evidence/task-1-resume-1-supabase-auth-rls-e2e.log",
      ".omo/evidence/task-1-resume-2-supabase-auth-rls-e2e.log",
    ])
    await verifyTaskTarget(fixture.context, "task-1")

    await writeAttempt(fixture, "task-1-resume-3-supabase-auth-rls-e2e.log", "REJECT")
    await assert.rejects(() => verifyTaskTarget(fixture.context, "task-1"), /latest.*APPROVE/i)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("evidence records reject noncanonical field order", async () => {
  const fixture = await evidenceFixture()
  try {
    const outputPath = ".omo/evidence/order-output.txt"
    await writeRepoFile(fixture, outputPath, "order proof\n")
    const unorderedRecord = {
      schemaVersion: 1,
      timestamp: "2026-07-17T00:00:00.000Z",
      db: { notApplicable: true, reason: "unit fixture" },
      http: { notApplicable: true, reason: "unit fixture" },
      cleanup: { command: "true", exitCode: 0, proofSha256: zeroSha },
      entryType: "final-verdict",
      command: "unordered",
      exitCode: 0,
      redactedOutputPath: outputPath,
      redactedOutputSha256: sha("order proof\n"),
      verdict: "APPROVE",
    }
    const evidencePath = ".omo/evidence/task-1-supabase-auth-rls-e2e.log"
    await writeRepoFile(fixture, evidencePath, `${JSON.stringify(unorderedRecord)}\n`)

    await assert.rejects(() => verifyEvidenceFile(fixture.context, evidencePath), /field order/i)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

test("create-f4-final requires strict current preflight and writes once", async () => {
  const fixture = await evidenceFixture()
  try {
    await assert.rejects(() => createF4FinalFromPreflight(fixture.context), /preflight/i)

    const outputPath = ".omo/evidence/f4-preflight-output.txt"
    const f3Path = ".omo/evidence/f3-supabase-auth-rls-e2e-runtime-qa.md"
    await writeRepoFile(fixture, outputPath, "f4 preflight output\n")
    await writeRepoFile(
      fixture,
      f3Path,
      `${JSON.stringify(record(outputPath, "APPROVE", "f4 preflight output\n"))}\n`,
    )
    await writePreflight(fixture, { outputPath, f3Path, verdict: "REJECT" })
    await assert.rejects(() => createF4FinalFromPreflight(fixture.context), /READY/)

    await writePreflight(fixture, { outputPath, f3Path, outputSha256: zeroSha })
    await assert.rejects(() => createF4FinalFromPreflight(fixture.context), /hash/)

    await writePreflight(fixture, { outputPath, f3Path })
    await createF4FinalFromPreflight(fixture.context)
    const finalPath = path.join(fixture.root, ".omo/evidence/f4-supabase-auth-rls-e2e-scope.md")
    assert.equal((await stat(finalPath)).mode & 0o777, 0o600)
    assert.equal(JSON.parse((await readFile(finalPath, "utf8")).trim()).verdict, "APPROVE")
    await assert.rejects(() => createF4FinalFromPreflight(fixture.context), /already exists/)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

async function evidenceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-verify-evidence."))
  const evidenceRoot = path.join(root, ".omo/evidence")
  await import("node:fs/promises").then((fs) => fs.mkdir(evidenceRoot, { recursive: true }))
  return {
    context: { evidenceRoot: ".omo/evidence", repoRoot: root, runSecretScan: false },
    root,
  }
}

async function writeAttempt(fixture, fileName, verdict) {
  const outputPath = `.omo/evidence/${fileName}.out`
  const outputContent = `${fileName}\n`
  await writeRepoFile(fixture, outputPath, outputContent)
  await writeRepoFile(
    fixture,
    `.omo/evidence/${fileName}`,
    `${JSON.stringify(record(outputPath, verdict, outputContent))}\n`,
  )
}

async function writePreflight(fixture, { outputPath, f3Path, outputSha256, verdict = "READY" }) {
  const recordPath = ".omo/evidence/f4-preflight-record.json"
  const finalRecordContent = "f4 final record\n"
  const f3Content = `${JSON.stringify(record(outputPath, "APPROVE", "f4 preflight output\n"))}\n`
  await writeRepoFile(fixture, recordPath, finalRecordContent)
  const preflight = {
    schemaVersion: 1,
    verdict,
    commands: [
      {
        command: "node --test tests/supabase-e2e/evidence-redaction.test.mjs",
        exitCode: 0,
        name: "redaction",
        outputPath,
        outputSha256: outputSha256 ?? sha("f4 preflight output\n"),
      },
      {
        command: "node tests/supabase-e2e/verify-dependencies.mjs",
        exitCode: 0,
        name: "dependencies",
        outputPath,
        outputSha256: outputSha256 ?? sha("f4 preflight output\n"),
      },
      {
        command: "corepack pnpm supabase:assert-stopped",
        exitCode: 0,
        name: "cleanup",
        outputPath,
        outputSha256: outputSha256 ?? sha("f4 preflight output\n"),
      },
    ],
    f3: {
      db: { querySha256: "1".repeat(64), resultSha256: "2".repeat(64) },
      http: { bodySha256: "3".repeat(64), status: 200 },
      path: f3Path,
      sha256: sha(f3Content),
    },
    finalRecord: {
      ...record(recordPath, "APPROVE", finalRecordContent),
      command: "F4 scope fidelity final approval from strict preflight",
      entryType: "final-verdict",
    },
    invariants: {
      cleanup: "PASS",
      dependencyVerification: "PASS",
      f3Refs: "PASS",
      port3002: { after: "none", before: "none" },
      ports: { selectedNo3002: true, unionFree: true },
      providerRefundEdge: "NOT_CONFIGURED",
      runtimeDirs: { dotSupabase: "absent", supabaseTemp: "absent" },
      secretScan: "PASS",
      sourceManifest: "PASS",
    },
  }
  await writeRepoFile(
    fixture,
    ".omo/evidence/f4-supabase-auth-rls-e2e-preflight.json",
    JSON.stringify(preflight),
  )
}

function record(outputPath, verdict, outputContent) {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-17T00:00:00.000Z",
    entryType: "final-verdict",
    command: `record ${verdict}`,
    exitCode: verdict === "APPROVE" ? 0 : 1,
    redactedOutputPath: outputPath,
    redactedOutputSha256: sha(outputContent),
    db: { notApplicable: true, reason: "unit fixture" },
    http: { notApplicable: true, reason: "unit fixture" },
    cleanup: { command: "true", exitCode: 0, proofSha256: zeroSha },
    verdict,
  }
}

async function writeRepoFile(fixture, repoRelativePath, content) {
  const filePath = path.join(fixture.root, repoRelativePath)
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(path.dirname(filePath), { recursive: true }),
  )
  await writeFile(filePath, content, { mode: 0o600 })
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex")
}
