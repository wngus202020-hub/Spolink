import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"

const EVIDENCE_DIR = ".omo/evidence/lesson-image-upload/task-9"

export async function writeSummary({
  blockers,
  cleanup,
  observations,
  proxyObservations,
  sourceBinding,
}) {
  const label = /^[a-z0-9-]+$/u.test(process.env.SPOLINK_TASK9_RUN_LABEL ?? "")
    ? process.env.SPOLINK_TASK9_RUN_LABEL
    : "focused"
  const summary = {
    blockers,
    cleanup,
    observations,
    providerFaults: proxyObservations,
    redaction:
      "statuses and SHA-256 hashes only; no credentials, cookies, identities, URLs, or IDs",
    sourceBinding,
    verdict: blockers.length === 0 ? "PASS" : "BLOCKED",
  }
  await writeFile(
    `${EVIDENCE_DIR}/${label}-summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
    {
      mode: 0o600,
    },
  )
}

export function safeErrorCode(error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80)
  }
  return error instanceof assert.AssertionError ? "ASSERTION_ERROR" : "ERROR"
}

export function safeErrorFingerprint(error) {
  const message = error instanceof Error ? error.message : String(error)
  return createHash("sha256").update(message).digest("hex")
}

export function cleanupIsAllZero(cleanup) {
  return cleanup !== null && Object.values(cleanup).every((value) => value === 0)
}
