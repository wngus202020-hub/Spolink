import { chmod, readFile, stat } from "node:fs/promises"

import { sha256, writeJsonMode600 } from "./process.mjs"

const forbiddenPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  /postgres(?:ql)?:\/\/[^\s"']+/iu,
  /(?:authorization|cookie|password|set-cookie|token|serviceRoleKey)\s*[:=]\s*(?!\[REDACTED\])[^,\s"}]+/iu,
  /(?:Bearer\s+|eyJ)[A-Za-z0-9._-]+/u,
  /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/u,
]

const rawOutputFields = new Set([
  "details",
  "error",
  "failureDetails",
  "log",
  "message",
  "output",
  "rawPayload",
  "reporterOutput",
  "sourceContext",
  "stack",
  "stderr",
  "stdout",
  "trace",
  "traceHints",
])

const rawOutputTextPattern =
  /Running \d+ tests?|Error Context:|trace\.zip|\/Users\/|(?:\/private)?\/var\/folders\/|(?:^|\n)\s*at\s+\S+/iu

const allowedEvidenceFields = new Set([
  "epochHash",
  "exitCode",
  "failureClass",
  "failureHash",
  "fixtureCleanup",
  "grepApplied",
  "lifecycleCleanupReceipt",
  "outputHash",
  "rawOutputCleanupHash",
  "scenario",
  "schemaVersion",
  "selfHash",
  "signal",
  "specs",
  "verdict",
  "visuals",
])

export function assertCoachDashboardEvidenceRedacted(value) {
  const serialized = JSON.stringify(value)
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) throw new Error(`Coach dashboard evidence leak: ${pattern}`)
  }
}

export async function writeCoachDashboardEvidence(filePath, payload) {
  assertNoRawOutputFields(payload)
  assertBoundedEvidenceFields(payload)
  assertCoachDashboardEvidenceRedacted(payload)
  const evidence = {
    ...payload,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(payload)),
    },
  }
  assertCoachDashboardEvidenceRedacted(evidence)
  await writeJsonMode600(filePath, evidence)
  await chmod(filePath, 0o600)
  return evidence
}

export async function readCoachDashboardEvidence(filePath) {
  const parsed = JSON.parse(await readFile(filePath, "utf8"))
  const { selfHash, ...payload } = parsed
  if (
    selfHash?.algorithm !== "sha256" ||
    selfHash?.scope !== "canonical JSON payload before selfHash insertion" ||
    selfHash?.value !== sha256(JSON.stringify(payload))
  ) {
    throw new Error("Coach dashboard evidence self-hash mismatch")
  }
  if (((await stat(filePath)).mode & 0o777) !== 0o600) {
    throw new Error("Coach dashboard evidence must be mode 0600")
  }
  assertNoRawOutputFields(parsed)
  assertBoundedEvidenceFields(parsed)
  assertCoachDashboardEvidenceRedacted(parsed)
  return parsed
}

function assertBoundedEvidenceFields(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Coach dashboard evidence must be a structured object")
  }
  for (const key of Object.keys(value)) {
    if (!allowedEvidenceFields.has(key)) {
      throw new Error(`Coach dashboard unexpected evidence field refused: ${key}`)
    }
  }
}

function assertNoRawOutputFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawOutputFields(item)
    return
  }
  if (typeof value === "string") {
    if (rawOutputTextPattern.test(value)) {
      throw new Error("Coach dashboard raw output text refused")
    }
    return
  }
  if (typeof value !== "object" || value === null) return
  for (const [key, item] of Object.entries(value)) {
    if (rawOutputFields.has(key))
      throw new Error(`Coach dashboard raw output field refused: ${key}`)
    assertNoRawOutputFields(item)
  }
}
