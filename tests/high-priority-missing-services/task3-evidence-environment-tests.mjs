import assert from "node:assert/strict"
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import {
  computeTask3SourceBinding,
  writeFocusedReservationLifecycleReceipt,
} from "./task3-evidence.mjs"
import {
  contractAttemptRoot,
  passingObservations,
  remediationRoot,
  repoRoot,
  writePrivateJson,
} from "./task3-evidence-fixtures.mjs"
import { task3GateCommand } from "./task3-gate-contracts.mjs"
import {
  buildTask3AttemptManifest,
  verifyTask3AttemptEvidence,
} from "./verify-task3-attempt-evidence.mjs"

export function registerTask3EvidenceEnvironmentTests() {
  test("source-bound aggregate receipts serialize the exact replayable environment pair", () => {
    const attemptId = path.basename(contractAttemptRoot)
    const attemptRelative = `.omo/evidence/high-priority-missing-services/task-3/remediation/${attemptId}`
    const command =
      "corepack pnpm exec node " +
      "tests/high-priority-missing-services/run-task3-supabase-receipt.mjs " +
      `--attempt ${attemptRelative}`

    assert.equal(task3GateCommand(attemptId, "supabase-aggregate"), command)
    assert.equal(task3GateCommand(attemptId, "focused-db"), command)
    assert.equal(task3GateCommand(attemptId, "real-http"), command)
  })

  test("aggregate environment accepts only the current bound attempt and its confined output", async () => {
    const evidence = await import("./task3-evidence.mjs")
    assert.equal(typeof evidence.resolveTask3AggregateEnvironment, "function")

    const source = await computeTask3SourceBinding(repoRoot)
    const attemptId = path.basename(contractAttemptRoot)
    const attemptRelative = path.relative(repoRoot, contractAttemptRoot)
    const outputRelative = `${attemptRelative}/supabase-aggregate-outputs`
    await writePrivateJson(path.join(contractAttemptRoot, "task-3-binding.json"), {
      attemptId,
      capturedAt: new Date().toISOString(),
      head: source.head,
      recordType: "task-3-binding",
      schemaVersion: 1,
      sourceManifestSha256: source.manifestSha256,
      task: "task-3",
      worktreeStatusSha256: source.statusSha256,
    })

    assert.deepEqual(
      await evidence.resolveTask3AggregateEnvironment({
        attemptRoot: attemptRelative,
        outputDir: outputRelative,
        repoRoot,
      }),
      {
        attemptRoot: contractAttemptRoot,
        outputDir: path.join(contractAttemptRoot, "supabase-aggregate-outputs"),
      },
    )

    const invalid = [
      { attemptRoot: undefined, outputDir: undefined, repoRoot },
      { attemptRoot: "../attempt-stale", outputDir: outputRelative, repoRoot },
      { attemptRoot: attemptRelative, outputDir: ".omo/evidence/arbitrary-output", repoRoot },
      { attemptRoot: attemptRelative, outputDir: `${attemptRelative}/../escaped-output`, repoRoot },
      { attemptRoot: "/tmp/arbitrary-attempt", outputDir: "/tmp/arbitrary-output", repoRoot },
    ]
    for (const options of invalid)
      await assert.rejects(evidence.resolveTask3AggregateEnvironment(options))

    const staleRoot = path.join(remediationRoot, `attempt-task3-stale-${process.pid}`)
    await mkdir(staleRoot, { mode: 0o700 })
    try {
      await writePrivateJson(path.join(staleRoot, "task-3-binding.json"), {
        attemptId: path.basename(staleRoot),
        capturedAt: new Date().toISOString(),
        head: source.head,
        recordType: "task-3-binding",
        schemaVersion: 1,
        sourceManifestSha256: "0".repeat(64),
        task: "task-3",
        worktreeStatusSha256: source.statusSha256,
      })
      await assert.rejects(
        evidence.resolveTask3AggregateEnvironment({
          attemptRoot: path.relative(repoRoot, staleRoot),
          outputDir: `${path.relative(repoRoot, staleRoot)}/supabase-aggregate-outputs`,
          repoRoot,
        }),
        /current source/,
      )
    } finally {
      await rm(staleRoot, { recursive: true })
    }
  })

  // biome-ignore format: compact focused pass/fail contract.
  test("focused writer emits pass/fail only beneath the supplied active attempt", async () => {
    const outputPath = await writeFocusedReservationLifecycleReceipt({ attemptRoot: contractAttemptRoot,
      cleanup: ["observer-and-barrier-closed", "fixture-graph-removed"], observations: passingObservations(), repoRoot })
    const receipt = JSON.parse(await readFile(outputPath, "utf8"))
    assert.equal(outputPath, path.join(contractAttemptRoot, "focused-reservation-lifecycle.json"))
    assert.equal(receipt.verdict, "focused-pass")
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600)

    const failed = await writeFocusedReservationLifecycleReceipt({ attemptRoot: contractAttemptRoot,
      cleanup: ["observer-and-barrier-closed"], observations: [{ name: "authorization-state-replay-effects", status: "failed" }], repoRoot })
    assert.equal(JSON.parse(await readFile(failed, "utf8")).verdict, "focused-fail")
  })

  test("attempt verifier rejects missing, drifted, escaped, substituted, and unsorted evidence", async () => {
    const root = path.join(remediationRoot, `attempt-task3-evidence-scan-${process.pid}`)
    const nested = path.join(root, "nested")
    await mkdir(nested, { mode: 0o700, recursive: true })
    await writeFile(path.join(nested, "event.jsonl"), '{"status":"passed"}\n', { mode: 0o600 })
    await writePrivateJson(path.join(root, "result.json"), {
      databaseUrl: "postgresql://<redacted-db-uri>@127.0.0.1:5432/postgres",
      status: "passed",
    })
    try {
      const manifest = await buildTask3AttemptManifest(root, repoRoot)
      assert.deepEqual(
        manifest.references.map((entry) => entry.path),
        ["nested/event.jsonl", "result.json"],
      )
      assert.equal(
        (await verifyTask3AttemptEvidence({ attemptRoot: root, manifest }, repoRoot)).fileCount,
        2,
      )

      const missing = structuredClone(manifest)
      missing.references.pop()
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot: root, manifest: missing }, repoRoot),
        /file set/,
      )
      const drift = structuredClone(manifest)
      drift.references[0].sha256 = "0".repeat(64)
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot: root, manifest: drift }, repoRoot),
        /hash/,
      )
      const escaped = structuredClone(manifest)
      escaped.references[0].path = "../legacy.json"
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot: root, manifest: escaped }, repoRoot),
        /path/,
      )
      const substituted = structuredClone(manifest)
      substituted.references[0].path = ".omo/evidence/task-3-final-summary.json"
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot: root, manifest: substituted }, repoRoot),
        /path|file set/,
      )
      const unsorted = structuredClone(manifest)
      unsorted.references.reverse()
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot: root, manifest: unsorted }, repoRoot),
        /sorted/,
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test("focused writer rejects missing, shared, sibling, traversed, nonexistent, and symlink roots", async () => {
    const sibling = path.join(remediationRoot, `attempt-task3-sibling-${process.pid}`)
    const alias = path.join(remediationRoot, `attempt-task3-alias-${process.pid}`)
    const traversed = `${contractAttemptRoot}/../${path.basename(contractAttemptRoot)}`
    await mkdir(sibling, { mode: 0o700 })
    await symlink(contractAttemptRoot, alias)
    await symlink(
      path.join(contractAttemptRoot, "focused-reservation-lifecycle.json"),
      path.join(sibling, "focused-reservation-lifecycle.json"),
    )
    const base = { cleanup: [], observations: [], repoRoot }
    // biome-ignore format: compact attack matrix keeps every rejected path class adjacent.
    const invalid = [
      { ...base }, { ...base, attemptRoot: remediationRoot },
      { ...base, attemptRoot: contractAttemptRoot, outputDir: sibling }, { ...base, attemptRoot: traversed },
      { ...base, attemptRoot: path.join(remediationRoot, "attempt-does-not-exist") },
      { ...base, attemptRoot: alias }, { ...base, attemptRoot: sibling },
    ]
    try {
      for (const options of invalid)
        await assert.rejects(writeFocusedReservationLifecycleReceipt(options))
    } finally {
      await rm(alias)
      await rm(sibling, { recursive: true })
    }
  })
}
