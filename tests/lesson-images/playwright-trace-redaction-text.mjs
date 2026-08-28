const sensitiveNames = new Set([
  "accesstoken",
  "anonkey",
  "apikey",
  "authorization",
  "cookie",
  "email",
  "idtoken",
  "password",
  "refreshtoken",
  "servicekey",
  "setcookie",
  "token",
  "uploadtoken",
  "uploadurl",
])

import { collectAssignedSecretValues, redactLinearText } from "./trace-linear-redaction.mjs"

export function decodeRedactableText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decoded("utf16le", true, bytes.subarray(2).toString("utf16le"))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decoded("utf16be", true, decodeUtf16Be(bytes.subarray(2)))
  }
  const inferred = inferUtf16(bytes)
  if (inferred === "utf16le") return decoded(inferred, false, bytes.toString("utf16le"))
  if (inferred === "utf16be") return decoded(inferred, false, decodeUtf16Be(bytes))
  try {
    const hasBom = bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    const source = new TextDecoder("utf-8", { fatal: true }).decode(
      hasBom ? bytes.subarray(3) : bytes,
    )
    return decoded("utf8", hasBom, source)
  } catch {
    return null
  }
}

export function encodeRedactableText(entry, source) {
  if (entry.encoding === "utf8") {
    const bytes = Buffer.from(source, "utf8")
    return entry.hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]) : bytes
  }
  const bytes = Buffer.from(source, "utf16le")
  if (entry.encoding === "utf16be") swapPairs(bytes)
  if (!entry.hasBom) return bytes
  const bom = entry.encoding === "utf16le" ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xfe, 0xff])
  return Buffer.concat([bom, bytes])
}

export function discoverTraceSecrets(sources, suppliedSecrets) {
  const discovered = new Set(suppliedSecrets.filter(isSecretValue))
  for (const source of sources) {
    collectAssignments(source, discovered)
    collectParsed(parseJson(source), discovered)
    for (const line of source.split(/\r?\n/u)) collectParsed(parseJson(line), discovered)
  }
  return [...discovered].sort((left, right) => right.length - left.length)
}

export function sanitizeTraceText(source, secrets) {
  const parsed = parseJson(source)
  if (parsed !== null) return JSON.stringify(sanitizeValue(parsed, null, secrets))
  return source
    .split("\n")
    .map((line) => {
      if (!line) return line
      const parsedLine = parseJson(line)
      return parsedLine === null
        ? sanitizeString(line, secrets)
        : JSON.stringify(sanitizeValue(parsedLine, null, secrets))
    })
    .join("\n")
}

function decoded(encoding, hasBom, text) {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return null
  }
  return { encoding, hasBom, text }
}

function inferUtf16(bytes) {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return null
  let evenZeros = 0
  let oddZeros = 0
  const pairs = Math.min(bytes.length / 2, 512)
  for (let index = 0; index < pairs * 2; index += 2) {
    if (bytes[index] === 0) evenZeros += 1
    if (bytes[index + 1] === 0) oddZeros += 1
  }
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.1) return "utf16le"
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.1) return "utf16be"
  return null
}

function decodeUtf16Be(bytes) {
  const copy = Buffer.from(bytes)
  swapPairs(copy)
  return copy.toString("utf16le")
}

function swapPairs(bytes) {
  for (let index = 0; index < bytes.length; index += 2) {
    ;[bytes[index], bytes[index + 1]] = [bytes[index + 1], bytes[index]]
  }
}

function collectAssignments(source, discovered) {
  for (const value of collectAssignedSecretValues(source, isSensitiveName)) {
    if (isSecretValue(value)) discovered.add(value)
  }
}

function collectParsed(value, discovered, key = null) {
  if (value === null) return
  const normalizedKey = key ? normalizeName(key) : null
  if (normalizedKey && sensitiveNames.has(normalizedKey) && typeof value === "string") {
    if (isSecretValue(value)) discovered.add(value)
    return
  }
  if (typeof value === "string") {
    const nested = parseJson(value)
    if (nested !== null && typeof nested === "object") collectParsed(nested, discovered)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectParsed(item, discovered)
    return
  }
  if (typeof value !== "object") return
  const headerName = typeof value.name === "string" ? normalizeName(value.name) : null
  if (headerName && isSensitiveHeaderName(headerName) && isSecretValue(value.value)) {
    discovered.add(value.value)
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectParsed(entryValue, discovered, entryKey)
  }
}

function sanitizeValue(value, key, secrets) {
  const normalizedKey = key ? normalizeName(key) : null
  if (normalizedKey && sensitiveNames.has(normalizedKey)) return placeholder(normalizedKey)
  if (typeof value === "string") return sanitizeString(value, secrets)
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, null, secrets))
  if (value === null || typeof value !== "object") return value
  const headerName = typeof value.name === "string" ? normalizeName(value.name) : null
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue], index) => [
      sanitizeObjectKey(entryKey, secrets, index),
      headerName && isSensitiveHeaderName(headerName) && entryKey === "value"
        ? "<redacted>"
        : sanitizeValue(entryValue, entryKey, secrets),
    ]),
  )
}

function sanitizeObjectKey(key, secrets, index) {
  const sanitized = redactLinearText(
    key,
    secrets,
    () => false,
    () => "<redacted>",
  )
  return sanitized === key ? key : `${sanitized}#${index + 1}`
}

function sanitizeString(value, secrets) {
  const nested = parseJson(value)
  if (nested !== null && typeof nested === "object") {
    return JSON.stringify(sanitizeValue(nested, null, secrets))
  }
  return redactLinearText(value, secrets, isSensitiveName, placeholder)
}

function placeholder(normalizedName) {
  if (normalizedName.includes("email")) return "<redacted-email>"
  if (normalizedName.includes("password") || normalizedName.includes("passwd")) {
    return "<redacted-password>"
  }
  if (normalizedName.includes("uploadurl")) return "<redacted-signed-upload-url>"
  return "<redacted>"
}

function parseJson(source) {
  try {
    return JSON.parse(source)
  } catch {
    return null
  }
}

function isSecretValue(value) {
  return typeof value === "string" && value.length >= 4 && !value.startsWith("<redacted")
}

function normalizeName(value) {
  let normalized = ""
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
      normalized += character.toLowerCase()
    }
  }
  return normalized
}

function isSensitiveName(normalizedName) {
  if (sensitiveNames.has(normalizedName)) return true
  return [
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "cookie",
    "email",
    "userid",
  ].some((part) => normalizedName.includes(part))
}

function isSensitiveHeaderName(normalizedName) {
  return ["authorization", "cookie", "token", "apikey", "servicekey"].some((part) =>
    normalizedName.includes(part),
  )
}
