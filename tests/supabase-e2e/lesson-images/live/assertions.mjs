import { createHash } from "node:crypto"

import { statusObservation } from "../http-client.mjs"

export function recordMutation(context, label, result) {
  context.observations.push(statusObservation(label, result))
  if (result.cacheControl !== "private, no-store") {
    context.blockers.push({
      actual: result.cacheControl ?? "missing",
      criterion: `${label}_cache_control`,
      expected: "private, no-store",
    })
  }
  if (!result.contentType?.startsWith("application/json")) {
    context.blockers.push({
      actual: result.contentType ?? "missing",
      criterion: `${label}_json_response`,
      expected: "application/json",
    })
  }
}

export function expectStatus(context, label, result, expected) {
  if (result.status === expected) return
  context.blockers.push({
    actual: result.status,
    code: result.code,
    criterion: label,
    expected,
  })
}

export function validSubmitIntentRace(statuses) {
  return (
    JSON.stringify(statuses) === JSON.stringify([200, 403]) ||
    JSON.stringify(statuses) === JSON.stringify([201, 409])
  )
}

export function canonicalObjectName(objectName, lessonId, extension) {
  const escapedLesson = lessonId.replaceAll("-", "\\-")
  return new RegExp(
    `^${escapedLesson}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${extension}$`,
  ).test(objectName)
}

export function syntheticResult(status, code) {
  return {
    body: null,
    bodySha256: hashJson(null),
    cacheControl: null,
    code,
    contentType: null,
    status,
  }
}

export function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex")
}
