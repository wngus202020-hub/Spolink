import { createHash } from "node:crypto"

export async function requestJson(
  baseUrl,
  path,
  { body, contentType = "application/json", jar = null, method = "POST", origin = true } = {},
) {
  const headers = {}
  if (contentType !== null) headers["content-type"] = contentType
  if (origin === true) headers.origin = new URL(baseUrl).origin
  if (typeof origin === "string") headers.origin = origin
  if (jar) headers.cookie = jar.cookieHeader()
  const response = await fetch(`${baseUrl}${path}`, {
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers,
    method,
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  return {
    body: parsed,
    bodySha256: sha256(text),
    cacheControl: response.headers.get("cache-control"),
    code: parsed?.error?.code ?? null,
    contentType: response.headers.get("content-type"),
    status: response.status,
  }
}

export function uploadSigned(client, intent, bytes, contentType, { upsert = false } = {}) {
  return client.storage
    .from("lesson-images")
    .uploadToSignedUrl(intent.objectName, intent.token, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert,
    })
}

export function upsertAuthenticated(client, objectName, bytes, contentType) {
  return client.storage
    .from("lesson-images")
    .upload(objectName, new Blob([bytes], { type: contentType }), {
      contentType,
      upsert: true,
    })
}

export function publicObjectUrl(apiUrl, objectName) {
  return `${apiUrl}/storage/v1/object/public/lesson-images/${objectName}`
}

export function statusObservation(label, result, extra = {}) {
  return {
    ...extra,
    bodySha256: result.bodySha256,
    label,
    status: result.status,
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
