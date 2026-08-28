import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { computeTask3SourceBinding } from "./task3-evidence.mjs"
import {
  contractAttemptRoot,
  createFixture,
  createLegacyPlaceholderFixture,
  finalizerPath,
  fixtureRoot,
  remediationRoot,
  repoRoot,
  requiredGates,
  sentinel,
  sha256,
  writePrivateJson,
} from "./task3-evidence-fixtures.mjs"
import {
  assertParentSwapAttacks,
  attemptOutput,
  replaceSameBytes,
  runFinalizer,
  runInjectedFinalizer,
} from "./task3-finalizer-attack-helpers.mjs"

export function registerTask3EvidenceFinalizerTests() {
  test("finalizer rejects legacy placeholder text and preserves its sentinel", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    const fixture = await createLegacyPlaceholderFixture(source)
    const before = sha256(await readFile(fixture.outputPath))
    const result = await runFinalizer(fixture.root, attemptOutput("legacy-placeholder"))
    assert.notEqual(result.exitCode, 0)
    assert.equal(sha256(await readFile(fixture.outputPath)), before)
  })

  test("finalizer rejects prior and semantic adversarial receipts without touching output", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    // biome-ignore format: compact attack matrix keeps every receipt mutation visible together.
    const scenarios = [
      ["focused-pass-only", { keepGates: ["focused-contract"] }, "Missing receipts"],
      ["historical-pass", { receiptAttemptId: "historical-attempt" }, "different attempt"],
      ["stale-hash", { staleGate: "focused-db" }, "predates"], ["duplicate", { duplicateGate: "real-http" }, "Duplicate receipt"],
      ["wrong-source-hash", { wrongSourceGate: "lint" }, "source binding is stale"], ["malformed", { malformedGate: "build" }, "JSON is malformed"],
      ["missing-browser-project", { omitGate: "browser-mobile" }, "Missing receipts"], ["aggregate-fail", { failedGate: "supabase-aggregate" }, "schema or verdict"],
      ["dirty-source-drift", { bindingSourceHash: "f".repeat(64) }, "current source"], ["non-stopped", { nonStoppedGate: "stopped-cleanup" }, "result is invalid"],
      ["wrong-producer", { wrongProducerGate: "real-http" }, "schema or verdict"], ["wrong-command", { wrongCommandGate: "typecheck" }, "schema or verdict"],
      ["wrong-project-count", { wrongProjectCountGate: "browser-mobile" }, "result is invalid"], ["semantic-fail", { semanticFailGate: "lint" }, "result is invalid"],
      ["artifact-substitution", { substituteGate: "real-http" }, "schema or verdict"], ["artifact-path-escape", { pathEscapeGate: "build" }, "schema or verdict"],
      ["artifact-symlink", { symlinkGate: "evidence-scan" }, "symbolic link"],
    ]
    for (const [name, mutation, reason] of scenarios) {
      const fixture = await createFixture(name, source, mutation)
      const before = sha256(await readFile(fixture.outputPath))
      const result = await runFinalizer(fixture.root, attemptOutput(name))
      assert.notEqual(result.exitCode, 0, `${name} must reject`)
      assert.match(result.stderr, new RegExp(reason), `${name} rejected for the wrong reason`)
      assert.equal(sha256(await readFile(fixture.outputPath)), before, `${name} touched output`)
    }
  })

  test("finalizer writes verified from the exact current producer and artifact contracts", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    const fixture = await createFixture("all-pass", source)
    const outputPath = attemptOutput("all-pass")
    const result = await runFinalizer(fixture.root, outputPath)
    assert.equal(result.exitCode, 0, result.stderr)
    const final = JSON.parse(await readFile(outputPath, "utf8"))
    assert.equal(final.status, "verified")
    assert.deepEqual(
      final.gates.map((entry) => entry.gate),
      requiredGates,
    )
    assert.deepEqual(final.source, source)
  })

  test("finalizer accepts only the evidence-scan command derived from its active attempt", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    const attemptId = `attempt-current-evidence-scan-${process.pid}`
    const fixture = await createFixture(attemptId, source)
    const expectedCommand =
      "corepack pnpm exec node tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs" +
      ` --attempt .omo/evidence/high-priority-missing-services/task-3/remediation/${attemptId}`
    const currentArtifactPath = path.join(fixture.root, "artifacts/evidence-scan.json")
    const currentArtifact = JSON.parse(await readFile(currentArtifactPath, "utf8"))

    assert.equal(currentArtifact.command, expectedCommand)
    assert.equal(
      (await runFinalizer(fixture.root, attemptOutput("current-evidence-scan"))).exitCode,
      0,
    )

    const staleAttemptId = `attempt-stale-evidence-scan-${process.pid}`
    const staleCommand =
      "corepack pnpm exec node tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs" +
      ` --attempt .omo/evidence/high-priority-missing-services/task-3/remediation/${staleAttemptId}`
    currentArtifact.command = staleCommand
    const staleArtifact = Buffer.from(`${JSON.stringify(currentArtifact, null, 2)}\n`)
    await writeFile(currentArtifactPath, staleArtifact, { mode: 0o600 })
    const staleReceiptPath = path.join(fixture.root, "receipts/evidence-scan.json")
    const staleReceipt = JSON.parse(await readFile(staleReceiptPath, "utf8"))
    staleReceipt.command = staleCommand
    staleReceipt.artifact.sha256 = sha256(staleArtifact)
    await writePrivateJson(staleReceiptPath, staleReceipt)

    const stale = await runFinalizer(fixture.root, attemptOutput("stale-evidence-scan"))
    assert.notEqual(stale.exitCode, 0)
    assert.match(stale.stderr, /schema or verdict/)
  })

  // biome-ignore format: compact controlled-swap matrix keeps all protected inputs adjacent.
  test("finalizer rejects controlled binding, receipt, and artifact swaps before publication", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    for (const kind of ["binding", "receipt", "artifact"]) {
      const fixture = await createFixture(`swap-${kind}`, source); const outputPath = attemptOutput(`swap-${kind}`)
      const target = kind === "binding" ? path.join(fixture.root, "task-3-binding.json")
        : path.join(fixture.root, kind === "receipt" ? "receipts/focused-contract.json" : "artifacts/focused-contract.json")
      const historical = await readFile(fixture.outputPath); await rm(outputPath, { force: true })
      await assert.rejects(runInjectedFinalizer(fixture.root, outputPath, async () => replaceSameBytes(target)), /drifted/)
      assert.equal(sha256(await readFile(fixture.outputPath)), sha256(historical))
      await assert.rejects(readFile(outputPath), { code: "ENOENT" })
    }
  })

  // biome-ignore format: compact output attack matrix keeps every protected destination adjacent.
  test("finalizer refuses pre-existing, arbitrary, and CLI-selected attempt outputs", async () => {
    const source = await computeTask3SourceBinding(repoRoot); const fixture = await createFixture("protected-output", source)
    const protectedPath = attemptOutput("protected"); await writeFile(protectedPath, sentinel, { mode: 0o600 })
    const before = sha256(await readFile(protectedPath))
    await assert.rejects(runInjectedFinalizer(fixture.root, protectedPath), /must not already exist/)
    assert.equal(sha256(await readFile(protectedPath)), before)
    const racedOutput = attemptOutput("raced"); await rm(racedOutput, { force: true })
    await assert.rejects(runInjectedFinalizer(fixture.root, racedOutput, async () => {
      await writeFile(racedOutput, sentinel, { mode: 0o600 })
    }), /must not already exist/)
    assert.equal(sha256(await readFile(racedOutput)), sha256(sentinel))
    const arbitrary = path.join(remediationRoot, `arbitrary-${process.pid}.json`); await rm(arbitrary, { force: true })
    await assert.rejects(runInjectedFinalizer(fixture.root, arbitrary))
    const outputAlias = path.join(contractAttemptRoot, `output-alias-${process.pid}`); await symlink(fixtureRoot, outputAlias)
    try { await assert.rejects(runInjectedFinalizer(fixture.root, path.join(outputAlias, "task-1-finalizer-alias.json"))) }
    finally { await rm(outputAlias) }
    const historicalPaths = [path.join(repoRoot, ".omo/evidence/high-priority-missing-services/task-3/reservation-lifecycle.json"),
      path.join(repoRoot, ".omo/evidence/high-priority-missing-services/task-3/final-gate-review.json")]
    for (const historicalPath of historicalPaths) {
      const historicalHash = sha256(await readFile(historicalPath)); await assert.rejects(runInjectedFinalizer(fixture.root, historicalPath))
      assert.equal(sha256(await readFile(historicalPath)), historicalHash)
    }
    const cliOutput = attemptOutput("cli-selected"); await rm(cliOutput, { force: true })
    const cli = spawnSync(process.execPath, [finalizerPath, "--receipts", fixture.root, "--output", cliOutput], { cwd: repoRoot })
    assert.notEqual(cli.status, 0)
    await assert.rejects(readFile(cliOutput), { code: "ENOENT" })
  })

  test("finalizer anchors attempt and canonical publication across output-parent symlink and replacement", async () => {
    const source = await computeTask3SourceBinding(repoRoot)
    await assertParentSwapAttacks(source)
  })
}
