import { createHash } from "node:crypto"
import path from "node:path"

export const task3HeadPattern = /^[a-f0-9]{40}$/u
export const task3Sha256Pattern = /^[a-f0-9]{64}$/u

export class Task3EvidenceError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "Task3EvidenceError"
    this.code = options.code ?? "TASK3_EVIDENCE_INVALID"
    this.causes = Object.freeze({ ...(options.causes ?? {}) })
  }
}

export function requireTask3Object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Task3EvidenceError(`${label} must be an object`)
  }
}

export function requireTask3ExactKeys(value, expected) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.join("\0") !== sortedExpected.join("\0")) {
    throw new Task3EvidenceError("Evidence object has missing or unknown fields")
  }
}

export function parseTask3Binding(value) {
  requireTask3Object(value, "binding")
  requireTask3ExactKeys(value, [
    "attemptId",
    "capturedAt",
    "head",
    "recordType",
    "schemaVersion",
    "sourceManifestSha256",
    "task",
    "worktreeStatusSha256",
  ])
  if (
    value.schemaVersion !== 1 ||
    value.recordType !== "task-3-binding" ||
    value.task !== "task-3" ||
    !isTask3SafeAttemptId(value.attemptId) ||
    !isTask3IsoTimestamp(value.capturedAt) ||
    !task3HeadPattern.test(value.head) ||
    !task3Sha256Pattern.test(value.sourceManifestSha256) ||
    !task3Sha256Pattern.test(value.worktreeStatusSha256)
  )
    throw new Task3EvidenceError("Binding schema is invalid")
  return value
}

export function isTask3SafeAttemptId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)
}

export function isTask3SafeRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !path.isAbsolute(value) &&
    !value.split("/").includes("..")
  )
}

export function isTask3IsoTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return false
  return new Date(value).toISOString() === value
}

export function task3Sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
