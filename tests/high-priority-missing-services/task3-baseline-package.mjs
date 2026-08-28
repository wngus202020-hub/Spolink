import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  isTask3IsoTimestamp,
  isTask3SafeRelativePath,
  requireTask3ExactKeys,
  requireTask3Object,
  Task3EvidenceError,
} from "./task3-evidence.mjs"
import { snapshotFile } from "./task3-finalizer-validation.mjs"

const packageFiles = Object.freeze([
  "task-1-allowlist.json",
  "task-1-dirty-baseline.json",
  "task-1-parent-plan-baseline.md",
  "task-1-source-baseline.sha256",
])
const sha256Pattern = /^[a-f0-9]{64}$/u
const headPattern = /^[a-f0-9]{40}$/u

export async function verifyTask3BaselinePackage(attemptRoot) {
  const packageValue = await readJson(path.join(attemptRoot, "task-1-baseline-package.json"))
  requireTask3Object(packageValue, "baseline package")
  requireTask3ExactKeys(packageValue, ["recordType", "references", "schemaVersion"])
  if (
    packageValue.schemaVersion !== 1 ||
    packageValue.recordType !== "task-3-remediation-baseline-package" ||
    !Array.isArray(packageValue.references)
  ) {
    throw new Task3EvidenceError("Baseline package schema is invalid")
  }
  const referencedPaths = packageValue.references.map((entry) => entry?.path)
  if (referencedPaths.join("\0") !== packageFiles.join("\0")) {
    throw new Task3EvidenceError("Baseline package references are incomplete or unsorted")
  }
  for (const reference of packageValue.references) {
    requireTask3Object(reference, "baseline package reference")
    requireTask3ExactKeys(reference, ["path", "sha256"])
    if (!sha256Pattern.test(reference.sha256)) {
      throw new Task3EvidenceError("Baseline package reference hash is invalid")
    }
    const snapshot = await snapshotFile(path.join(attemptRoot, reference.path), reference.path)
    if (snapshot.sha256 !== reference.sha256) {
      throw new Task3EvidenceError(`Baseline package hash mismatch: ${reference.path}`)
    }
  }

  const baseline = await readJson(path.join(attemptRoot, "task-1-dirty-baseline.json"))
  validateBaseline(baseline)
  const allowlist = await readJson(path.join(attemptRoot, "task-1-allowlist.json"))
  validateAllowlist(allowlist)
  await validateShaList(attemptRoot, baseline.entries)
  const parentBaseline = await readFile(
    path.join(attemptRoot, "task-1-parent-plan-baseline.md"),
    "utf8",
  )
  if ((parentBaseline.match(/^- \[ \] 3\. /gmu) ?? []).length !== 1) {
    throw new Task3EvidenceError("Parent baseline must contain one unchecked Task 3")
  }
  return { allowlistCount: allowlist.paths.length, baselineCount: baseline.entries.length }
}

function validateBaseline(value) {
  requireTask3Object(value, "dirty baseline")
  requireTask3ExactKeys(value, [
    "baselineCapturedAt",
    "entries",
    "head",
    "recordType",
    "schemaVersion",
  ])
  if (
    value.schemaVersion !== 1 ||
    value.recordType !== "task-3-remediation-dirty-baseline" ||
    !isTask3IsoTimestamp(value.baselineCapturedAt) ||
    !headPattern.test(value.head) ||
    !Array.isArray(value.entries) ||
    value.entries.length === 0
  ) {
    throw new Task3EvidenceError("Dirty baseline schema is invalid")
  }
  let previous = ""
  for (const entry of value.entries) {
    requireTask3Object(entry, "dirty baseline entry")
    requireTask3ExactKeys(entry, ["kind", "path", "sha256"])
    if (
      !["file", "missing", "non-file", "symlink"].includes(entry.kind) ||
      !isTask3SafeRelativePath(entry.path) ||
      !sha256Pattern.test(entry.sha256) ||
      (previous && previous.localeCompare(entry.path) >= 0)
    ) {
      throw new Task3EvidenceError("Dirty baseline entry is invalid or unsorted")
    }
    previous = entry.path
  }
}

function validateAllowlist(value) {
  requireTask3Object(value, "allowlist")
  requireTask3ExactKeys(value, ["paths", "recordType", "schemaVersion"])
  if (
    value.schemaVersion !== 1 ||
    value.recordType !== "task-3-remediation-allowlist" ||
    !Array.isArray(value.paths) ||
    value.paths.length === 0 ||
    value.paths.some(
      (entry, index) =>
        !isTask3SafeRelativePath(entry) ||
        (index > 0 && value.paths[index - 1].localeCompare(entry) >= 0),
    )
  ) {
    throw new Task3EvidenceError("Allowlist must be explicit, safe, unique, and sorted")
  }
}

async function validateShaList(attemptRoot, entries) {
  const body = await readFile(path.join(attemptRoot, "task-1-source-baseline.sha256"), "utf8")
  const expected = entries
    .map((entry) => `${entry.sha256}  ${entry.path}`)
    .join("\n")
    .concat("\n")
  if (body !== expected) throw new Task3EvidenceError("Dirty baseline SHA list is inconsistent")
}

async function readJson(filePath) {
  const snapshot = await snapshotFile(filePath, path.basename(filePath))
  try {
    return JSON.parse(snapshot.body.toString("utf8"))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Task3EvidenceError("Baseline package JSON is malformed")
    throw error
  }
}
