import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { verifyTask3AttemptSeal } from "./task3-attempt-seal.mjs"
import { verifyTask3BaselinePackage } from "./task3-baseline-package.mjs"
import { computeTask3SourceBinding } from "./task3-evidence.mjs"
import {
  cleanupTask3Fixtures,
  createFixture,
  prepareTask3Fixtures,
  repoRoot,
  sha256,
  writePrivateJson,
} from "./task3-evidence-fixtures.mjs"
import { isTask3FileOwnedByCurrentUid } from "./task3-evidence-scanner.mjs"
import { attemptOutput, runFinalizer } from "./task3-finalizer-attack-helpers.mjs"
import {
  buildTask3AttemptManifest,
  verifyTask3AttemptEvidence,
} from "./verify-task3-attempt-evidence.mjs"

const remediationRoot = path.join(
  repoRoot,
  ".omo/evidence/high-priority-missing-services/task-3/remediation",
)
const verifierPath = path.join(
  repoRoot,
  "tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs",
)
const terminalReportNames = [
  "final-f1-plan-compliance.md",
  "final-f2-code-security.md",
  "final-f3-manual-qa.json",
  "final-f4-scope-fidelity.md",
  "task-7-independent-gate-review.md",
]

test.before(prepareTask3Fixtures)
test.after(cleanupTask3Fixtures)

test("evidence descriptor ownership accepts the current UID and rejects a foreign UID", () => {
  assert.equal(typeof process.getuid, "function")
  const currentUid = BigInt(process.getuid())

  assert.equal(isTask3FileOwnedByCurrentUid({ uid: currentUid }, currentUid), true)
  assert.equal(isTask3FileOwnedByCurrentUid({ uid: currentUid + 1n }, currentUid), false)
})

test("sealed evidence scan rejects later materialization without changing its artifact", async () => {
  const attemptRoot = path.join(remediationRoot, `attempt-seal-regression-${process.pid}`)
  await mkdir(attemptRoot, { mode: 0o700 })
  await writeBaselinePackage(attemptRoot)
  await writePrivateJson(path.join(attemptRoot, "pre-seal.json"), { verdict: "passed" })
  try {
    const first = runVerifier(attemptRoot)
    assert.equal(first.status, 0, first.stderr)
    const artifactPath = path.join(attemptRoot, "task-7-evidence-hygiene.json")
    const sealedHash = sha256(await readFile(artifactPath))
    await mkdir(path.join(attemptRoot, "receipts"), { mode: 0o700 })
    await writePrivateJson(path.join(attemptRoot, "receipts/evidence-scan.json"), {
      excludedGeneratedReceipt: true,
    })
    await writePrivateJson(path.join(attemptRoot, "post-receipt.json"), { late: true })

    const second = runVerifier(attemptRoot)
    assert.notEqual(second.status, 0)
    assert.match(second.stderr, /file set does not match its manifest/)
    assert.equal(sha256(await readFile(artifactPath)), sealedHash)
  } finally {
    await rm(attemptRoot, { force: true, recursive: true })
  }
})

test("sealed evidence scan permits only safe exact terminal review outputs", async () => {
  const attemptRoot = path.join(remediationRoot, `attempt-terminal-reports-${process.pid}`)
  await mkdir(attemptRoot, { mode: 0o700 })
  await writePrivateJson(path.join(attemptRoot, "sealed.json"), { verdict: "passed" })
  try {
    const manifest = await buildTask3AttemptManifest(attemptRoot, repoRoot)
    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(manifest.terminalOutputPolicy, {
      excludedFromSealedReferencesOnly: true,
      paths: terminalReportNames,
      requiredFileMode: "0600",
      requiredLinkCount: 1,
      requiredLocation: "attempt-root",
      verification: "descriptor-o_nofollow-fstat-sha256",
    })
    for (const name of terminalReportNames) {
      const body = name.endsWith(".json") ? '{"verdict":"passed"}\n' : `${name}\n`
      await writeFile(path.join(attemptRoot, name), body, { mode: 0o600 })
    }

    const verified = await verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot)
    assert.deepEqual(
      verified.terminalOutputs.map(({ path: outputPath }) => outputPath),
      terminalReportNames,
    )
    assert.ok(
      verified.terminalOutputs.every(
        (output) => output.mode === "0600" && /^[a-f0-9]{64}$/u.test(output.sha256),
      ),
    )

    await writePrivateJson(path.join(attemptRoot, "attacker-chosen.md"), { verdict: "passed" })
    await assert.rejects(
      verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot),
      /file set/,
    )
    await rm(path.join(attemptRoot, "attacker-chosen.md"))

    const firstReport = path.join(attemptRoot, terminalReportNames[0])
    await chmod(firstReport, 0o644)
    await assert.rejects(
      verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot),
      /mode must be 0600/,
    )
    await chmod(firstReport, 0o600)

    await rm(firstReport)
    await link(path.join(attemptRoot, terminalReportNames[1]), firstReport)
    await assert.rejects(
      verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot),
      /hard link/,
    )
  } finally {
    await rm(attemptRoot, { force: true, recursive: true })
  }
})

test("evidence scan rejects symlink hardlink and inode swaps before descriptor reads", async () => {
  for (const attack of ["symlink", "hardlink", "inode"]) {
    const attemptRoot = path.join(remediationRoot, `attempt-scan-${attack}-${process.pid}`)
    const evidencePath = path.join(attemptRoot, "evidence.json")
    const replacementPath = `${attemptRoot}-replacement-${attack}.json`
    await mkdir(attemptRoot, { mode: 0o700 })
    await writePrivateJson(evidencePath, { status: "passed" })
    const manifest = await buildTask3AttemptManifest(attemptRoot, repoRoot)
    await writePrivateJson(replacementPath, { status: "replacement" })
    try {
      await assert.rejects(
        verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot, {
          beforeFileOpen: async (relative) => {
            if (relative !== "evidence.json") return
            await rm(evidencePath)
            if (attack === "symlink") await symlink(replacementPath, evidencePath)
            else if (attack === "hardlink") await link(replacementPath, evidencePath)
            else await writePrivateJson(evidencePath, { status: "passed" })
          },
        }),
        /changed before descriptor open|hard link|symbolic link/,
        `${attack} swap must be rejected`,
      )
    } finally {
      await rm(attemptRoot, { force: true, recursive: true })
      await rm(replacementPath, { force: true })
    }
  }
})

test("finished attempt rehashes every receipt artifact after all materialization", async () => {
  const source = await computeTask3SourceBinding(repoRoot)
  const fixture = await createFixture("finished-artifact-rehash", source)
  const verified = await verifyTask3AttemptSeal(fixture.root)
  assert.equal(verified.receiptCount, 11)

  await writePrivateJson(path.join(fixture.root, "artifacts/build.json"), { corrupted: true })
  await assert.rejects(verifyTask3AttemptSeal(fixture.root), /Artifact hash mismatch: build/)
})

test("baseline package keeps the full dirty baseline and allowlist separate and content-bound", async () => {
  const attemptRoot = path.join(remediationRoot, `attempt-baseline-regression-${process.pid}`)
  await mkdir(attemptRoot, { mode: 0o700 })
  try {
    await writeBaselinePackage(attemptRoot)
    const result = await verifyTask3BaselinePackage(attemptRoot)
    assert.deepEqual(result, { allowlistCount: 2, baselineCount: 2 })

    const allowlistPath = path.join(attemptRoot, "task-1-allowlist.json")
    const allowlist = JSON.parse(await readFile(allowlistPath, "utf8"))
    allowlist.paths.push("tests/unbound-addition.mjs")
    await writePrivateJson(allowlistPath, allowlist)
    await assert.rejects(verifyTask3BaselinePackage(attemptRoot), /hash mismatch/)
  } finally {
    await rm(attemptRoot, { force: true, recursive: true })
  }
})

test("same-attempt corrupted artifact hash reaches corruption validation and preserves canonical", async () => {
  const source = await computeTask3SourceBinding(repoRoot)
  const fixture = await createFixture("same-attempt-corrupt-hash", source)
  const receiptPath = path.join(fixture.root, "receipts/build.json")
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
  receipt.artifact.sha256 = "0".repeat(64)
  await writePrivateJson(receiptPath, receipt)
  const before = sha256(await readFile(fixture.outputPath))

  const result = await runFinalizer(fixture.root, attemptOutput("same-attempt-corrupt-hash"))
  assert.notEqual(result.exitCode, 0)
  assert.match(result.stderr, /Artifact hash does not match its receipt/)
  assert.doesNotMatch(result.stderr, /different attempt/)
  assert.equal(sha256(await readFile(fixture.outputPath)), before)
})

function runVerifier(attemptRoot) {
  return spawnSync(process.execPath, [verifierPath, "--attempt", attemptRoot], {
    cwd: repoRoot,
    encoding: "utf8",
  })
}

async function writeBaselinePackage(attemptRoot) {
  const entries = [
    { kind: "file", path: "a.txt", sha256: "a".repeat(64) },
    { kind: "missing", path: "z.txt", sha256: "b".repeat(64) },
  ]
  const files = {
    "task-1-allowlist.json": JSON.stringify(
      {
        paths: ["tests/fix.mjs", "tests/fix.test.mjs"],
        recordType: "task-3-remediation-allowlist",
        schemaVersion: 1,
      },
      null,
      2,
    ).concat("\n"),
    "task-1-dirty-baseline.json": JSON.stringify(
      {
        baselineCapturedAt: "2026-08-17T00:00:00.000Z",
        entries,
        head: "a".repeat(40),
        recordType: "task-3-remediation-dirty-baseline",
        schemaVersion: 1,
      },
      null,
      2,
    ).concat("\n"),
    "task-1-parent-plan-baseline.md": "- [ ] 3. Implement reservation completion\n",
    "task-1-source-baseline.sha256": entries
      .map((entry) => `${entry.sha256}  ${entry.path}`)
      .join("\n")
      .concat("\n"),
  }
  for (const [name, body] of Object.entries(files)) {
    await writeFile(path.join(attemptRoot, name), body, { mode: 0o600 })
    await chmod(path.join(attemptRoot, name), 0o600)
  }
  await writePrivateJson(path.join(attemptRoot, "task-1-baseline-package.json"), {
    recordType: "task-3-remediation-baseline-package",
    references: Object.keys(files)
      .sort()
      .map((file) => ({ path: file, sha256: hash(files[file]) })),
    schemaVersion: 1,
  })
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}
