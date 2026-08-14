import { randomUUID } from "node:crypto"
import { open, rename, writeFile } from "node:fs/promises"
import path from "node:path"

const evidenceFields = [
  "schemaVersion",
  "timestamp",
  "entryType",
  "command",
  "exitCode",
  "redactedOutputPath",
  "redactedOutputSha256",
  "db",
  "http",
  "cleanup",
  "verdict",
]

const sha256Pattern = /^[a-f0-9]{64}$/
const jwtPattern = /eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
const supabaseKeyPattern = /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/
const spolinkEmailPattern = /\b[A-Za-z0-9._%+-]+@spolink\.test\b/i
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

export async function appendRedactedEvidence(filePath, exactRecord, runSecrets) {
  validateEvidenceRecord(exactRecord)
  const sanitizedRecord = sanitizeForEvidence(exactRecord, runSecrets)
  await appendMode600(filePath, `${JSON.stringify(sanitizedRecord)}\n`)
}

export async function writeRedactedJson(filePath, exactObject, runSecrets) {
  const sanitizedObject = sanitizeForEvidence(exactObject, runSecrets)
  await writeMode600Atomic(filePath, JSON.stringify(sanitizedObject))
}

export async function appendRedactedJsonLine(filePath, exactObject, runSecrets) {
  const sanitizedObject = sanitizeForEvidence(exactObject, runSecrets)
  await appendMode600(filePath, `${JSON.stringify(sanitizedObject)}\n`)
}

function sanitizeForEvidence(value, runSecrets) {
  const secrets = normalizeRunSecrets(runSecrets)
  return sanitizeValue(value, secrets, null)
}

function validateEvidenceRecord(record) {
  if (!isPlainObject(record)) {
    throw new Error("Evidence record must be an object")
  }

  const keys = Object.keys(record)
  for (const key of keys) {
    if (!evidenceFields.includes(key)) {
      throw new Error(`Unknown evidence field: ${key}`)
    }
  }
  for (const key of evidenceFields) {
    if (!keys.includes(key)) {
      throw new Error(`Missing evidence field: ${key}`)
    }
  }

  if (record.schemaVersion !== 1) {
    throw new Error("Evidence schemaVersion must be 1")
  }
  if (typeof record.timestamp !== "string" || Number.isNaN(Date.parse(record.timestamp))) {
    throw new Error("Evidence timestamp must be an ISO timestamp")
  }
  if (!["command", "manual-qa", "cleanup", "final-verdict"].includes(record.entryType)) {
    throw new Error(`Invalid evidence entryType: ${record.entryType}`)
  }
  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new Error("Evidence command must be a non-empty string")
  }
  if (!Number.isInteger(record.exitCode)) {
    throw new Error("Evidence exitCode must be an integer")
  }
  if (typeof record.redactedOutputPath !== "string" || record.redactedOutputPath.length === 0) {
    throw new Error("Evidence redactedOutputPath must be a non-empty string")
  }
  if (!sha256Pattern.test(record.redactedOutputSha256)) {
    throw new Error("Evidence redactedOutputSha256 must be lowercase SHA-256")
  }
  validateObservation(record.db, "db")
  validateObservation(record.http, "http")
  validateCleanup(record.cleanup)
  if (![null, "APPROVE", "REJECT"].includes(record.verdict)) {
    throw new Error("Evidence verdict must be null, APPROVE, or REJECT")
  }
}

function validateObservation(value, fieldName) {
  if (!isPlainObject(value)) {
    throw new Error(`Evidence ${fieldName} must be an object`)
  }

  if (value.notApplicable === true) {
    const keys = Object.keys(value).sort()
    if (keys.join(",") !== "notApplicable,reason") {
      throw new Error(`Evidence ${fieldName} notApplicable shape is invalid`)
    }
    if (typeof value.reason !== "string" || value.reason.length === 0) {
      throw new Error(`Evidence ${fieldName} reason must be non-empty`)
    }
    return
  }

  const requiredKeys =
    fieldName === "db" ? ["querySha256", "resultSha256"] : ["bodySha256", "status"]
  const keys = Object.keys(value).sort()
  if (keys.join(",") !== requiredKeys.slice().sort().join(",")) {
    throw new Error(`Evidence ${fieldName} hash shape is invalid`)
  }
  if (fieldName === "db") {
    if (!sha256Pattern.test(value.querySha256) || !sha256Pattern.test(value.resultSha256)) {
      throw new Error("Evidence db hashes must be lowercase SHA-256")
    }
    return
  }
  if (!Number.isInteger(value.status) || !sha256Pattern.test(value.bodySha256)) {
    throw new Error("Evidence http status/body hash is invalid")
  }
}

function validateCleanup(value) {
  if (!isPlainObject(value)) {
    throw new Error("Evidence cleanup must be an object")
  }
  const keys = Object.keys(value).sort()
  if (keys.join(",") !== "command,exitCode,proofSha256") {
    throw new Error("Evidence cleanup shape is invalid")
  }
  if (typeof value.command !== "string" || value.command.length === 0) {
    throw new Error("Evidence cleanup command must be non-empty")
  }
  if (!Number.isInteger(value.exitCode) || !sha256Pattern.test(value.proofSha256)) {
    throw new Error("Evidence cleanup exit/proof is invalid")
  }
}

function sanitizeValue(value, runSecrets, keyContext) {
  if (keyContext && isSensitiveKey(keyContext) && !isRedactedPlaceholder(value)) {
    throw new Error(`Unredacted sensitive assignment in evidence: ${keyContext}`)
  }
  if (typeof value === "string") {
    rejectSensitiveString(value, runSecrets)
    return value.replace(uuidPattern, "<redacted-uuid>")
  }
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && value.length === 2) {
      return [value[0], sanitizeValue(value[1], runSecrets, value[0])]
    }
    return value.map((item) => sanitizeValue(item, runSecrets, null))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeValue(entryValue, runSecrets, key),
      ]),
    )
  }
  return value
}

function isRedactedPlaceholder(value) {
  if (value === null || value === "<redacted>") return true
  if (Array.isArray(value)) return value.every(isRedactedPlaceholder)
  if (isPlainObject(value)) return Object.values(value).every(isRedactedPlaceholder)
  return false
}

function isSensitiveKey(key) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-.\s]+/g, "_")
    .toLowerCase()
  if (["authorization", "cookie", "set_cookie"].includes(normalized)) return true
  if (["api_key", "database_url", "id_token", "refresh_token"].includes(normalized)) return true
  if (
    normalized.endsWith("_key") &&
    ["provider_payment", "service_role", "supabase", "toss_payments"].some((prefix) =>
      normalized.includes(prefix),
    )
  ) {
    return true
  }
  const parts = normalized.split("_").filter(Boolean)
  return parts.some((part) => ["credential", "password", "secret", "token"].includes(part))
}

function rejectSensitiveString(value, runSecrets) {
  if (value === "<redacted>" || !value) {
    return
  }
  for (const secret of runSecrets) {
    if (secret && value.includes(secret)) {
      throw new Error("Unredacted run secret in evidence")
    }
  }
  if (jwtPattern.test(value)) {
    throw new Error("Unredacted JWT in evidence")
  }
  if (supabaseKeyPattern.test(value)) {
    throw new Error("Unredacted Supabase key in evidence")
  }
  for (const match of value.matchAll(/(?:^|[^\w-])(?:cookie|set-cookie)\s*:\s*([^\r\n]*)/gi)) {
    if (match[1].trim() !== "<redacted>") {
      throw new Error("Unredacted Cookie header in evidence")
    }
  }
  for (const match of value.matchAll(/(?:^|[^\w-])authorization\s*:\s*([^\r\n]*)/gi)) {
    if (match[1].trim() !== "<redacted>") {
      throw new Error("Unredacted Authorization header in evidence")
    }
  }
  if (spolinkEmailPattern.test(value)) {
    throw new Error("Unredacted fixture email in evidence")
  }
  rejectPostgresCredentialUrl(value)
}

function rejectPostgresCredentialUrl(value) {
  for (const match of value.matchAll(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi)) {
    const url = new URL(match[0])
    if (url.username || url.password) {
      throw new Error("Unredacted PostgreSQL credential URL in evidence")
    }
  }
}

function normalizeRunSecrets(runSecrets) {
  if (!Array.isArray(runSecrets)) {
    throw new Error("runSecrets must be an array")
  }
  return runSecrets.filter((secret) => typeof secret === "string" && secret.length > 0)
}

async function appendMode600(filePath, content) {
  const handle = await open(filePath, "a", 0o600)
  try {
    await handle.writeFile(content, "utf8")
    await handle.chmod(0o600)
  } finally {
    await handle.close()
  }
}

async function writeMode600Atomic(filePath, content) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  await writeFile(tempPath, content, { mode: 0o600 })
  await rename(tempPath, filePath)
  const handle = await open(filePath, "r+")
  try {
    await handle.chmod(0o600)
  } finally {
    await handle.close()
  }
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}
