import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { createTask3GateArtifact, REQUIRED_TASK3_GATES } from "./task3-evidence.mjs"

export const repoRoot = process.cwd()
export const remediationRoot = path.join(
  repoRoot,
  ".omo/evidence/high-priority-missing-services/task-3/remediation",
)
export const contractAttemptRoot =
  process.env.SPOLINK_TASK3_CONTRACT_ATTEMPT_ROOT ??
  path.join(remediationRoot, `attempt-task3-contract-${process.pid}`)
export const fixtureRoot = path.join(contractAttemptRoot, "fixtures")
export const finalizerPath = path.join(
  repoRoot,
  "tests/high-priority-missing-services/finalize-task3.mjs",
)
export const sentinel = Buffer.from("historical-canonical-sentinel\n")
export const requiredGates = [...REQUIRED_TASK3_GATES]

export async function prepareTask3Fixtures() {
  if (!process.env.SPOLINK_TASK3_CONTRACT_ATTEMPT_ROOT)
    await rm(contractAttemptRoot, { force: true, recursive: true })
  await mkdir(fixtureRoot, { mode: 0o700, recursive: true })
}

export async function cleanupTask3Fixtures() {
  if (process.env.SPOLINK_TASK3_RETAIN_CONTRACT_FIXTURES !== "1")
    await rm(process.env.SPOLINK_TASK3_CONTRACT_ATTEMPT_ROOT ? fixtureRoot : contractAttemptRoot, {
      force: true,
      recursive: true,
    })
}

export async function createFixture(name, source, mutation = {}) {
  const root = path.join(fixtureRoot, name)
  const receiptsDir = path.join(root, "receipts")
  const artifactsDir = path.join(root, "artifacts")
  const outputPath = path.join(root, "canonical.json")
  const capturedAt = "2026-08-16T06:00:00.000Z"
  await mkdir(receiptsDir, { mode: 0o700, recursive: true })
  await mkdir(artifactsDir, { mode: 0o700, recursive: true })
  await writePrivateJson(
    path.join(root, "task-3-binding.json"),
    binding(name, source, capturedAt, mutation),
  )
  await writeFile(outputPath, sentinel, { mode: 0o600 })
  for (const gate of mutation.keepGates ?? requiredGates) {
    if (gate === mutation.omitGate) continue
    const artifact = structuredClone(createTask3GateArtifact(name, gate, source))
    if (gate === mutation.wrongProducerGate) artifact.producer = "wrong-producer.mjs"
    if (gate === mutation.wrongCommandGate) artifact.command = "printf placeholder"
    if (gate === mutation.semanticFailGate) {
      artifact.result.failedCount = 1
      artifact.result.passedCount -= 1
    }
    if (gate === mutation.nonStoppedGate) {
      artifact.result.facts.stopped = false
      artifact.result.facts.residueCount = 1
    }
    if (gate === mutation.wrongProjectCountGate) artifact.result.projectCount += 1
    const { command, producer } = artifact
    let artifactRelative = `artifacts/${gate}.json`
    let artifactBody = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`)
    const artifactPath = path.join(root, artifactRelative)
    await writeFile(artifactPath, artifactBody, { mode: 0o600 })
    if (gate === mutation.pathEscapeGate) {
      artifactRelative = "../escaped-artifact.json"
      await writeFile(path.join(root, artifactRelative), artifactBody, { mode: 0o600 })
    }
    if (gate === mutation.symlinkGate) {
      const target = path.join(artifactsDir, `${gate}-target.json`)
      await writeFile(target, artifactBody, { mode: 0o600 })
      await rm(artifactPath)
      await symlink(target, artifactPath)
    }
    if (gate === mutation.substituteGate) {
      artifactRelative = "artifacts/focused-db.json"
      artifactBody = await readFile(path.join(root, artifactRelative))
    }
    const receipt = {
      artifact: {
        mediaType: "application/json",
        path: artifactRelative,
        sha256: sha256(artifactBody),
      },
      attemptId: mutation.receiptAttemptId ?? name,
      command,
      exitCode: gate === mutation.failedGate ? 1 : 0,
      gate,
      observedAt: gate === mutation.staleGate ? "2026-08-16T05:59:59.000Z" : capturedAt,
      producer,
      recordType: "task-3-gate-receipt",
      schemaVersion: 1,
      source:
        gate === mutation.wrongSourceGate ? { ...source, manifestSha256: "0".repeat(64) } : source,
      task: "task-3",
      verdict: gate === mutation.failedGate ? "failed" : "passed",
    }
    const receiptPath = path.join(receiptsDir, `${gate}.json`)
    if (gate === mutation.malformedGate)
      await writeFile(receiptPath, "{malformed\n", { mode: 0o600 })
    else await writePrivateJson(receiptPath, receipt)
    if (gate === mutation.duplicateGate)
      await writePrivateJson(path.join(receiptsDir, `${gate}-duplicate.json`), receipt)
  }
  return { outputPath, root }
}

export async function createLegacyPlaceholderFixture(source) {
  const root = path.join(fixtureRoot, "legacy-placeholder")
  const outputPath = path.join(root, "canonical.json")
  await mkdir(path.join(root, "receipts"), { mode: 0o700, recursive: true })
  await mkdir(path.join(root, "artifacts"), { mode: 0o700, recursive: true })
  await writePrivateJson(
    path.join(root, "task-3-binding.json"),
    binding("legacy-placeholder", source, "2026-08-16T06:00:00.000Z"),
  )
  await writeFile(outputPath, sentinel, { mode: 0o600 })
  for (const gate of requiredGates) {
    const body = Buffer.from(`placeholder:${gate}\n`)
    const artifactPath = `artifacts/${gate}.txt`
    await writeFile(path.join(root, artifactPath), body, { mode: 0o600 })
    await writePrivateJson(path.join(root, "receipts", `${gate}.json`), {
      artifact: { path: artifactPath, sha256: sha256(body) },
      attemptId: "legacy-placeholder",
      command: `fixture:${gate}`,
      details: {},
      exitCode: 0,
      gate,
      observedAt: "2026-08-16T06:00:00.000Z",
      recordType: "task-3-gate-receipt",
      schemaVersion: 1,
      source,
      task: "task-3",
      verdict: "passed",
    })
  }
  return { outputPath, root }
}

export function passingObservations() {
  return [
    { name: "authorization-state-replay-effects", status: "passed" },
    { name: "completion-no-show-cancellation-payment-races", status: "passed" },
  ]
}

export async function writePrivateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function binding(attemptId, source, capturedAt, mutation = {}) {
  return {
    attemptId,
    capturedAt,
    head: source.head,
    recordType: "task-3-binding",
    schemaVersion: 1,
    sourceManifestSha256: mutation.bindingSourceHash ?? source.manifestSha256,
    task: "task-3",
    worktreeStatusSha256: source.statusSha256,
  }
}
