import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { evidenceFields, repoPath, sha256, shaPattern } from "./constants.mjs"

export async function verifyEvidenceFile(context, filePath, remediation = new Map()) {
  const text = await readFile(repoPath(context, filePath), "utf8")
  const lines = text.trim().split(/\n/).filter(Boolean)
  assert.equal(lines.length > 0, true, `${filePath} is empty`)
  const records = []
  let sawVerdict = false
  for (const line of lines) {
    const record = JSON.parse(line)
    assertRecord(record)
    if (sawVerdict) throw new Error(`${filePath} contains records after final verdict`)
    if (record.verdict !== null) sawVerdict = true
    await assertCurrentHash(context, record, remediation)
    records.push(record)
  }
  const final = records.at(-1)
  assert.notEqual(final.verdict, null, `${filePath} lacks terminal verdict`)
  return { final, records }
}

export async function assertCurrentHash(context, record, remediation) {
  const current = sha256(await readFile(repoPath(context, record.redactedOutputPath)))
  if (current === record.redactedOutputSha256) return
  const remediated = remediation.get(record.redactedOutputPath)
  assert.equal(remediated?.newSha256, current, `stale evidence hash: ${record.redactedOutputPath}`)
}

export function assertRecord(record) {
  assert.deepEqual(Object.keys(record), evidenceFields, "evidence field order mismatch")
  assert.equal(record.schemaVersion, 1)
  assert.equal(Number.isNaN(Date.parse(record.timestamp)), false)
  assert.equal(
    ["command", "manual-qa", "cleanup", "final-verdict"].includes(record.entryType),
    true,
  )
  assert.equal(typeof record.command, "string")
  assert.equal(Number.isInteger(record.exitCode), true)
  assert.match(record.redactedOutputSha256, shaPattern)
  assertObservation(record.db, "db")
  assertObservation(record.http, "http")
  assert.deepEqual(Object.keys(record.cleanup).sort(), ["command", "exitCode", "proofSha256"])
  assert.match(record.cleanup.proofSha256, shaPattern)
  assert.equal([null, "APPROVE", "REJECT"].includes(record.verdict), true)
}

function assertObservation(value, key) {
  if (value.notApplicable === true) {
    assert.deepEqual(Object.keys(value).sort(), ["notApplicable", "reason"])
    assert.equal(typeof value.reason, "string")
    return
  }
  if (key === "db") {
    assert.deepEqual(Object.keys(value).sort(), ["querySha256", "resultSha256"])
    assert.match(value.querySha256, shaPattern)
    assert.match(value.resultSha256, shaPattern)
    return
  }
  assert.deepEqual(Object.keys(value).sort(), ["bodySha256", "status"])
  assert.match(value.bodySha256, shaPattern)
  assert.equal(Number.isInteger(value.status), true)
}
