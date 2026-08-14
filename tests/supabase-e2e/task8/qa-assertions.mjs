import assert from "node:assert/strict"
import { stat } from "node:fs/promises"
import path from "node:path"

import { assertLearnerCookieJar } from "./qa-cookies.mjs"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function assertMode0600(filePath, label) {
  const mode = (await stat(filePath)).mode & 0o777
  assert.equal(mode, 0o600, `${label} must be mode 0600`)
}

export async function assertMetadata(metadataPath, repoRoot = process.cwd()) {
  assert.equal(path.isAbsolute(metadataPath), true, "QA metadata path must be absolute")
  assertOutsideRepo(metadataPath, repoRoot)
  await assertMode0600(metadataPath, "QA metadata")
  const metadata = JSON.parse(await readText(metadataPath))
  assert.deepEqual(Object.keys(metadata).sort(), [
    "baseUrl",
    "cookieJarPath",
    "releasePath",
    "reservationId",
  ])
  assert.equal(typeof metadata.baseUrl, "string")
  const baseUrl = new URL(metadata.baseUrl)
  assert.equal(baseUrl.origin, metadata.baseUrl)
  assert.equal(typeof metadata.reservationId, "string")
  assert.match(metadata.reservationId, uuidPattern)
  for (const key of ["cookieJarPath", "releasePath"]) {
    assert.equal(path.isAbsolute(metadata[key]), true, `${key} must be absolute`)
    assertOutsideRepo(metadata[key], repoRoot)
    await assertMode0600(metadata[key], key)
  }
  await assertLearnerCookieJar(metadata.cookieJarPath, metadata.baseUrl)
  return metadata
}

export function assertConfiguredBody(body) {
  assertExactKeys(body, ["configured", "invalidKeys", "missingKeys"], "configured body")
  assert.deepEqual(body, { configured: true, invalidKeys: [], missingKeys: [] })
}

export function assertUnauthorizedBody(body) {
  assertExactKeys(body, ["error"], "unauthorized body")
  assertExactKeys(body.error, ["code", "details", "message"], "unauthorized error")
  assert.deepEqual(body, {
    error: { code: "UNAUTHORIZED", details: [], message: "Authentication required." },
  })
}

export function assertCancellationBody(body, reservationId, status, amount, refundStatus) {
  assertExactKeys(body, ["data"], "cancellation body")
  assertExactKeys(
    body.data,
    ["cancelledAt", "refund", "reservationId", "status"],
    "cancellation data",
  )
  assert.equal(body.data.reservationId, reservationId)
  assert.equal(body.data.status, status)
  assert.equal(Number.isNaN(Date.parse(body.data.cancelledAt)), false)
  assertExactKeys(body.data.refund, ["amount", "id", "status"], "cancellation refund")
  assert.match(body.data.refund.id, uuidPattern)
  assert.equal(body.data.refund.amount, amount)
  assert.equal(body.data.refund.status, refundStatus)
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} must have exact keys ${sortedExpected.join(",")}`)
  }
}

async function readText(filePath) {
  const { readFile } = await import("node:fs/promises")
  return readFile(filePath, "utf8")
}

function assertOutsideRepo(filePath, repoRoot) {
  const relative = path.relative(repoRoot, filePath)
  assert.notEqual(relative, "", "path must be outside repository")
  assert.equal(
    relative.startsWith("..") || path.isAbsolute(relative),
    true,
    "path must be outside repository",
  )
}
