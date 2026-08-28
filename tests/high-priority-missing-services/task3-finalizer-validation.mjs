import { constants } from "node:fs"
import { lstat, open, readdir } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  computeTask3SourceBinding,
  createTask3GateArtifact,
  parseTask3Binding,
  parseTask3Receipt,
  REQUIRED_TASK3_GATES,
  Task3EvidenceError,
  task3Sha256,
  validateTask3Receipt,
} from "./task3-evidence.mjs"

const noFollowRead = constants.O_RDONLY | constants.O_NOFOLLOW

export async function validateTask3FinalizerInputs(context) {
  const bindingSnapshot = await snapshotJson(
    path.join(context.receiptsRoot, "task-3-binding.json"),
    "binding",
  )
  const binding = parseTask3Binding(bindingSnapshot.value)
  if (binding.attemptId !== path.basename(context.receiptsRoot))
    throw new Task3EvidenceError("Binding attempt does not match the receipt directory")
  const currentSource = await computeTask3SourceBinding(context.repoRoot)
  if (
    binding.head !== currentSource.head ||
    binding.sourceManifestSha256 !== currentSource.manifestSha256 ||
    binding.worktreeStatusSha256 !== currentSource.statusSha256
  )
    throw new Task3EvidenceError("Binding does not match the current source")
  const receiptSet = await snapshotReceipts(context.receiptsRoot)
  const receiptsByGate = new Map()
  const snapshots = [bindingSnapshot, receiptSet.directory]
  for (const entry of receiptSet.entries) {
    const receipt = parseTask3Receipt(entry.snapshot.value)
    validateTask3Receipt(receipt, { binding, receiptsByGate })
    snapshots.push(entry.snapshot, await validateArtifact(context.receiptsRoot, receipt))
    receiptsByGate.set(receipt.gate, { path: entry.snapshot.path, receipt })
  }
  requireCompleteGateSet(receiptsByGate)
  if (context.beforePublish)
    await context.beforePublish({ snapshots: snapshots.map(({ path: filePath }) => filePath) })
  if (!isDeepStrictEqual(await computeTask3SourceBinding(context.repoRoot), currentSource))
    throw new Task3EvidenceError("Source changed during finalization")
  await revalidateReceiptSet(receiptSet)
  for (const snapshot of snapshots) await revalidateSnapshot(snapshot)
  if (context.publication === "attempt") await requireAbsent(context.outputPath)
  for (const snapshot of context.outputSnapshots) await revalidateSnapshot(snapshot)
  return { binding, currentSource, receiptsByGate }
}

export async function snapshotFile(filePath, label) {
  let handle
  try {
    handle = await open(filePath, noFollowRead)
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new Task3EvidenceError(`${label} must be a regular file`)
    const body = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    if (!sameIdentity(before, after) || BigInt(body.byteLength) !== after.size)
      throw new Task3EvidenceError(`${label} changed while being read`)
    return { body, identity: fileIdentity(after), label, path: filePath, sha256: task3Sha256(body) }
  } catch (error) {
    if (error?.code === "ELOOP")
      throw new Task3EvidenceError(`${label} must not be a symbolic link`)
    throw error
  } finally {
    await handle?.close()
  }
}

export async function snapshotDirectory(directoryPath, label = "receipt directory") {
  const fileStat = await lstat(directoryPath, { bigint: true })
  if (fileStat.isSymbolicLink() || !fileStat.isDirectory())
    throw new Task3EvidenceError(`${label} must be a real directory`)
  return { identity: fileIdentity(fileStat), label, path: directoryPath }
}

export function fileIdentity(fileStat) {
  return { dev: fileStat.dev, ino: fileStat.ino, mtimeNs: fileStat.mtimeNs, size: fileStat.size }
}

export function sameNodeIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

export async function requireAbsent(filePath) {
  try {
    await lstat(filePath)
    throw new Task3EvidenceError("Attempt output must not already exist")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

async function snapshotJson(filePath, label) {
  const snapshot = await snapshotFile(filePath, label)
  return { ...snapshot, value: parseJson(snapshot.body.toString("utf8"), label) }
}

async function snapshotReceipts(receiptsRoot) {
  const receiptsDir = path.join(receiptsRoot, "receipts")
  const directory = await snapshotDirectory(receiptsDir)
  const entries = await readdir(receiptsDir, { withFileTypes: true })
  if (entries.length === 0) throw new Task3EvidenceError("Receipt directory is empty")
  const names = entries.map(({ name }) => name).sort()
  const snapshots = await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json"))
        throw new Task3EvidenceError("Receipt directory contains an unsafe entry")
      return { snapshot: await snapshotJson(path.join(receiptsDir, entry.name), "receipt") }
    }),
  )
  return { directory, entries: snapshots, names, path: receiptsDir }
}

async function revalidateSnapshot(snapshot) {
  if (!snapshot.body) {
    const current = await snapshotDirectory(snapshot.path)
    if (!sameIdentity(snapshot.identity, current.identity))
      throw new Task3EvidenceError(`${snapshot.label} identity drifted`)
    return
  }
  const current = await snapshotFile(snapshot.path, snapshot.label)
  if (!sameIdentity(snapshot.identity, current.identity) || snapshot.sha256 !== current.sha256)
    throw new Task3EvidenceError(`${snapshot.label} identity or content drifted before publication`)
}

async function revalidateReceiptSet(receiptSet) {
  const names = (await readdir(receiptSet.path)).sort()
  if (!isDeepStrictEqual(names, receiptSet.names))
    throw new Task3EvidenceError("Receipt set drifted before publication")
}

function sameIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

async function validateArtifact(receiptsRoot, receipt) {
  const artifactPath = path.resolve(receiptsRoot, receipt.artifact.path)
  const relative = path.relative(receiptsRoot, artifactPath)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Task3EvidenceError("Artifact escapes the receipt directory")
  const snapshot = await snapshotJson(artifactPath, "artifact")
  if (snapshot.sha256 !== receipt.artifact.sha256)
    throw new Task3EvidenceError("Artifact hash does not match its receipt")
  if (
    !isDeepStrictEqual(
      snapshot.value,
      createTask3GateArtifact(receipt.attemptId, receipt.gate, receipt.source),
    )
  )
    throw new Task3EvidenceError("Artifact producer, invocation, binding, or result is invalid")
  return snapshot
}

function requireCompleteGateSet(receiptsByGate) {
  const missing = REQUIRED_TASK3_GATES.filter((gate) => !receiptsByGate.has(gate))
  if (missing.length > 0) throw new Task3EvidenceError(`Missing receipts: ${missing.join(", ")}`)
  if (receiptsByGate.size !== REQUIRED_TASK3_GATES.length)
    throw new Task3EvidenceError("Unexpected receipt gate")
}

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Task3EvidenceError(`${label} JSON is malformed`)
    throw error
  }
}
