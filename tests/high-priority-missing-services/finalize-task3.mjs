#!/usr/bin/env node
import { constants } from "node:fs"
import { lstat, open, realpath } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { publishTask3Anchored } from "./task3-directory-publisher.mjs"
import {
  REQUIRED_TASK3_GATES,
  requireTask3ExactKeys,
  resolveTask3ActiveAttemptRoot,
  Task3EvidenceError,
} from "./task3-evidence.mjs"
import {
  fileIdentity,
  requireAbsent,
  sameNodeIdentity,
  snapshotDirectory,
  snapshotFile,
  validateTask3FinalizerInputs,
} from "./task3-finalizer-validation.mjs"

// biome-ignore format: canonical path is intentionally one immutable literal.
const canonicalRelative = ".omo/evidence/high-priority-missing-services/task-3/reservation-lifecycle.json"
const anchoredDirectoryRead = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli()

// biome-ignore format: compact CLI boundary.
async function runCli() {
  try {
    const evidence = await finalizeTask3Evidence(parseArgs(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify({ gateCount: evidence.gates.length, status: evidence.status })}\n`)
  } catch (error) {
    // no-excuse-ok: catch - this is the CLI trust boundary and must fail closed.
    const message = error instanceof Error ? error.message : "unknown finalizer error"
    process.stderr.write(`Task 3 finalization rejected: ${message}\n`)
    process.exitCode = 1
  }
}

// biome-ignore format: compact boundary parser.
function parseArgs(values) {
  if (values.length !== 2 || values[0] !== "--receipts" || !values[1]) {
    throw new Task3EvidenceError("Usage: finalize-task3.mjs --receipts <active-attempt-dir>")
  }
  return { receiptsDir: values[1] }
}

// biome-ignore format: compact production publication boundary.
export async function finalizeTask3Evidence(options) {
  requireTask3ExactKeys(options, ["receiptsDir"])
  const repoRoot = process.cwd()
  const receiptsRoot = await resolveTask3ActiveAttemptRoot(options.receiptsDir, repoRoot)
  const publication = await resolveCanonicalOutput(repoRoot)
  try {
    return await finalizeValidated({ beforePublish: undefined, beforePublication: undefined,
      ...publication, publication: "canonical", receiptsRoot, repoRoot })
  } finally { await publication.directoryHandle.close() }
}

// biome-ignore format: compact test-only dependency injection boundary.
export async function finalizeTask3EvidenceForTest(options, dependencies) {
  requireTask3ExactKeys(options, ["receiptsDir"])
  requireTask3ExactKeys(dependencies,
    ["attemptRoot", "beforePublish", "beforePublication", "outputPath", "publication"])
  if (typeof dependencies.beforePublish !== "function" || typeof dependencies.beforePublication !== "function") {
    throw new Task3EvidenceError("Test publication hooks must be functions")
  }
  if (dependencies.publication !== "attempt" && dependencies.publication !== "canonical") {
    throw new Task3EvidenceError("Test publication mode is invalid")
  }
  const repoRoot = process.cwd()
  const attemptRoot = await resolveTask3ActiveAttemptRoot(dependencies.attemptRoot, repoRoot)
  const receiptsRoot = await resolveFixtureReceipts(options.receiptsDir, attemptRoot)
  const publication = await resolveAttemptOutput(dependencies.outputPath, attemptRoot, dependencies.publication)
  try {
    return await finalizeValidated({ beforePublish: dependencies.beforePublish,
      beforePublication: dependencies.beforePublication, ...publication,
      publication: dependencies.publication, receiptsRoot, repoRoot })
  } finally { await publication.directoryHandle.close() }
}

// biome-ignore format: one linear validate-revalidate-publish transaction.
async function finalizeValidated(context) {
  const { binding, currentSource, receiptsByGate } = await validateTask3FinalizerInputs(context)
  const finalEvidence = buildFinalEvidence(binding, receiptsByGate, context.receiptsRoot, context.repoRoot, currentSource)
  if (context.beforePublication) await context.beforePublication()
  await publish(context, finalEvidence)
  const publishedParent = await snapshotDirectory(context.outputParentPath, "output directory")
  if (!sameNodeIdentity(context.directoryIdentity, publishedParent.identity)) {
    throw new Task3EvidenceError("output directory identity drifted after publication")
  }
  return finalEvidence
}

// biome-ignore format: compact immutable publication record builder.
function buildFinalEvidence(binding, receiptsByGate, receiptsRoot, repoRoot, source) {
  const gates = REQUIRED_TASK3_GATES.map((gate) => {
    const entry = receiptsByGate.get(gate)
    return { artifact: entry.receipt.artifact, gate, receiptPath: path.relative(receiptsRoot, entry.path) }
  })
  return { attemptId: binding.attemptId, gates, receiptRoot: path.relative(repoRoot, receiptsRoot), schemaVersion: 1,
    source, status: "verified", task: "task-3", verifiedAt: new Date().toISOString() }
}

// biome-ignore format: compact test-only containment boundary.
async function resolveFixtureReceipts(input, attemptRoot) {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\") || input.split("/").includes("..")) {
    throw new Task3EvidenceError("Fixture receipt path is unsafe")
  }
  const resolved = path.resolve(input)
  const real = await realpath(resolved)
  const relative = path.relative(attemptRoot, real)
  if (real !== resolved || !relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Task3EvidenceError("Fixture receipts must remain inside the active attempt root")
  }
  return real
}

// biome-ignore format: compact exclusive attempt-output boundary.
async function resolveAttemptOutput(input, attemptRoot, publication) {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\") || input.split("/").includes("..")) {
    throw new Task3EvidenceError("Attempt output path is unsafe")
  }
  const outputPath = path.resolve(input)
  if (path.dirname(outputPath) !== attemptRoot || !/^task-1-(?:finalizer|toctou)-[A-Za-z0-9._-]+\.json$/u.test(path.basename(outputPath))) {
    throw new Task3EvidenceError("Attempt output must be a direct task-1 finalizer file in the active attempt root")
  }
  if (publication === "attempt") await requireAbsent(outputPath)
  else {
    const outputStat = await lstat(outputPath)
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) {
      throw new Task3EvidenceError("Canonical test output must be a regular file")
    }
  }
  return openPublicationDirectory(attemptRoot, outputPath,
    publication === "attempt" ? [] : [await snapshotFile(outputPath, "canonical test output")])
}

// biome-ignore format: compact fixed canonical-output boundary.
async function resolveCanonicalOutput(repoRoot) {
  const outputPath = path.join(repoRoot, canonicalRelative)
  const parent = path.dirname(outputPath)
  if (await realpath(parent) !== parent) throw new Task3EvidenceError("Canonical output ancestors must not be symlinks")
  const outputStat = await lstat(outputPath)
  if (outputStat.isSymbolicLink() || !outputStat.isFile()) throw new Task3EvidenceError("Canonical output must be a regular file")
  return openPublicationDirectory(parent, outputPath, [await snapshotFile(outputPath, "canonical output")])
}

async function openPublicationDirectory(parent, outputPath, additionalSnapshots) {
  const directorySnapshot = await snapshotDirectory(parent, "output directory")
  const directoryHandle = await open(parent, anchoredDirectoryRead)
  const opened = await directoryHandle.stat({ bigint: true })
  if (
    !opened.isDirectory() ||
    !sameNodeIdentity(directorySnapshot.identity, fileIdentity(opened))
  ) {
    await directoryHandle.close()
    throw new Task3EvidenceError("Output directory changed while it was anchored")
  }
  return {
    directoryHandle,
    directoryIdentity: fileIdentity(opened),
    outputName: path.basename(outputPath),
    outputParentPath: parent,
    outputPath,
    outputSnapshots: [directorySnapshot, ...additionalSnapshots],
  }
}

// biome-ignore format: compact atomic publication transaction.
async function publish(context, value) {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  return publishTask3Anchored({ body, directoryHandle: context.directoryHandle,
    outputName: context.outputName, publication: context.publication })
}
