import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseFinalConfigText } from "../../tests/supabase-e2e/supabase-config-guard.mjs"
import { PROJECT_ID } from "./constants.mjs"
import { isPlainObject } from "./utils.mjs"

export function parseSupabaseStatus(output, { projectId = PROJECT_ID } = {}) {
  let status
  try {
    status = JSON.parse(output)
  } catch (error) {
    throw new Error(`Supabase status output must be a JSON object: ${error.message}`)
  }
  if (!isPlainObject(status)) {
    throw new Error("Supabase status output must be a JSON object")
  }
  const apiUrl = new URL(requiredString(status.API_URL, "API_URL"))
  const dbUrl = new URL(requiredString(status.DB_URL, "DB_URL"))
  const newPair = readKeyPair(status, "PUBLISHABLE_KEY", "SECRET_KEY")
  const legacyPair = readKeyPair(status, "ANON_KEY", "SERVICE_ROLE_KEY")
  if (!newPair.complete && !legacyPair.complete) {
    throw new Error("Supabase status must include a complete publishable/secret or legacy key pair")
  }
  if (newPair.partial || legacyPair.partial) {
    throw new Error("Supabase status key pairs must be complete")
  }
  validateLocalSupabaseStatus({ projectId, apiUrl, dbUrl })
  if (newPair.complete) {
    validateSupabaseKey(status.PUBLISHABLE_KEY, "PUBLISHABLE_KEY")
    validateSupabaseKey(status.SECRET_KEY, "SECRET_KEY")
  }
  if (legacyPair.complete) {
    validateJwt(status.ANON_KEY, "ANON_KEY")
    validateJwt(status.SERVICE_ROLE_KEY, "SERVICE_ROLE_KEY")
  }
  return {
    apiUrl,
    dbUrl,
    clientKeyName: newPair.complete ? "PUBLISHABLE_KEY" : "ANON_KEY",
    serviceKeyName: newPair.complete ? "SECRET_KEY" : "SERVICE_ROLE_KEY",
    redacted: redactStatus(status),
  }
}

export function validateLocalSupabaseStatus({ projectId = PROJECT_ID, apiUrl, dbUrl }) {
  if (projectId !== PROJECT_ID) {
    throw new Error(`Supabase project id must be ${PROJECT_ID}`)
  }
  for (const url of [apiUrl, dbUrl]) {
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      throw new Error("Supabase local status must resolve to a loopback hostname")
    }
  }
  if (apiUrl.protocol !== "http:") {
    throw new Error("Supabase API URL must use http: locally")
  }
  if (!["postgres:", "postgresql:"].includes(dbUrl.protocol)) {
    throw new Error("Supabase DB URL must use postgres: or postgresql:")
  }
  return true
}

export async function assertSafeLocalConfig(repoRoot) {
  const parsed = parseFinalConfigText(
    await readFile(path.join(repoRoot, "supabase", "config.toml"), "utf8"),
  )
  if (parsed.project_id !== PROJECT_ID) {
    throw new Error(`Supabase project id must be parsed from TOML and equal ${PROJECT_ID}`)
  }
  return parsed.project_id
}

function readKeyPair(status, publicName, secretName) {
  const publicPresent = typeof status[publicName] === "string" && status[publicName].length > 0
  const secretPresent = typeof status[secretName] === "string" && status[secretName].length > 0
  return { complete: publicPresent && secretPresent, partial: publicPresent !== secretPresent }
}

function validateSupabaseKey(value, name) {
  const pattern =
    name === "PUBLISHABLE_KEY" ? /^sb_publishable_[A-Za-z0-9_-]+$/ : /^sb_secret_[A-Za-z0-9_-]+$/
  if (!pattern.test(value)) {
    throw new Error(`${name} has an invalid local key format`)
  }
}

function validateJwt(value, name) {
  if (!/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} must be a JWT`)
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Supabase status is missing ${name}`)
  }
  return value
}

function redactStatus(status) {
  const redacted = { API_URL: status.API_URL, DB_URL: status.DB_URL }
  for (const key of ["PUBLISHABLE_KEY", "SECRET_KEY", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (key in status) {
      redacted[key] = "<redacted>"
    }
  }
  if (typeof redacted.DB_URL === "string") {
    const dbUrl = new URL(redacted.DB_URL)
    dbUrl.username = "<redacted>"
    dbUrl.password = "<redacted>"
    redacted.DB_URL = dbUrl.toString()
  }
  return redacted
}
