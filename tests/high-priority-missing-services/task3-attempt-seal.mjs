import { readdir } from "node:fs/promises"
import path from "node:path"
import {
  isTask3SafeRelativePath,
  parseTask3Receipt,
  REQUIRED_TASK3_GATES,
  Task3EvidenceError,
} from "./task3-evidence.mjs"
import { snapshotFile } from "./task3-finalizer-validation.mjs"

export async function verifyTask3AttemptSeal(attemptRoot) {
  const receiptsRoot = path.join(attemptRoot, "receipts")
  const entries = await readdir(receiptsRoot, { withFileTypes: true })
  const names = entries.map((entry) => entry.name).sort()
  if (
    entries.some(
      (entry) => !entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json"),
    )
  ) {
    throw new Task3EvidenceError("Receipt directory contains an unsafe entry")
  }
  const gates = new Set()
  for (const name of names) {
    const receiptSnapshot = await snapshotFile(path.join(receiptsRoot, name), "receipt")
    const receipt = parseTask3Receipt(parseJson(receiptSnapshot.body, `receipt ${name}`))
    if (gates.has(receipt.gate)) throw new Task3EvidenceError(`Duplicate receipt: ${receipt.gate}`)
    gates.add(receipt.gate)
    if (!isTask3SafeRelativePath(receipt.artifact.path)) {
      throw new Task3EvidenceError(`Unsafe artifact path: ${receipt.gate}`)
    }
    const artifactPath = path.resolve(attemptRoot, receipt.artifact.path)
    const relative = path.relative(attemptRoot, artifactPath)
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Task3EvidenceError(`Artifact escapes attempt: ${receipt.gate}`)
    }
    const artifact = await snapshotFile(artifactPath, `artifact ${receipt.gate}`)
    if (artifact.sha256 !== receipt.artifact.sha256) {
      throw new Task3EvidenceError(`Artifact hash mismatch: ${receipt.gate}`)
    }
  }
  const missing = REQUIRED_TASK3_GATES.filter((gate) => !gates.has(gate))
  if (missing.length > 0) throw new Task3EvidenceError(`Missing receipts: ${missing.join(", ")}`)
  if (gates.size !== REQUIRED_TASK3_GATES.length) {
    throw new Task3EvidenceError("Unexpected receipt gate")
  }
  return { receiptCount: gates.size }
}

function parseJson(body, label) {
  try {
    return JSON.parse(body.toString("utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Task3EvidenceError(`${label} JSON is malformed`)
    throw error
  }
}
