import { randomBytes } from "node:crypto"
import process from "node:process"

import { PROJECT_ID } from "./constants.mjs"
import { assertSafeParentEnv } from "./env.mjs"
import { isPlainObject } from "./utils.mjs"

const authFlowSecret = randomBytes(32).toString("base64url")

export function buildLocalAppEnv(status, parentEnv = process.env) {
  assertSafeParentEnv(parentEnv)
  const hostEnv = readRequiredHostEnv(parentEnv)
  const localStatus = parseLocalAppStatus(status)

  return {
    PATH: hostEnv.PATH,
    HOME: hostEnv.HOME,
    TMPDIR: hostEnv.TMPDIR,
    NEXT_PUBLIC_SUPABASE_URL: localStatus.apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: localStatus.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: localStatus.serviceRoleKey,
    SPOLINK_AUTH_FLOW_SECRET: authFlowSecret,
  }
}

function readRequiredHostEnv(parentEnv) {
  const result = {}
  for (const key of ["PATH", "HOME", "TMPDIR"]) {
    const value = parentEnv[key]
    if (typeof value !== "string" || value.length === 0) {
      throw new LocalAppEnvError(
        "missing_host_env",
        `Missing required environment variable: ${key}`,
      )
    }
    result[key] = value
  }
  return result
}

function parseLocalAppStatus(status) {
  if (!isPlainObject(status)) {
    throw new LocalAppEnvError("invalid_status", "Local Supabase status must be an object")
  }
  if (status.projectId !== PROJECT_ID) {
    throw new LocalAppEnvError("invalid_project", `Supabase project id must be ${PROJECT_ID}`)
  }

  let apiUrl
  try {
    apiUrl = new URL(requiredStatusString(status.apiUrl, "API URL"))
  } catch (error) {
    if (error instanceof LocalAppEnvError) throw error
    throw new LocalAppEnvError("invalid_api_url", "Supabase API URL is invalid")
  }
  if (apiUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
    throw new LocalAppEnvError("unsafe_api_url", "Supabase API URL must use loopback HTTP")
  }

  const anonKey = requiredStatusString(status.anonKey, "anonymous key")
  const serviceRoleKey = requiredStatusString(status.serviceRoleKey, "service role key")
  if (!isLocalAnonKey(anonKey)) {
    throw new LocalAppEnvError("invalid_anon_key", "Supabase anonymous key is invalid")
  }
  if (!isLocalServiceKey(serviceRoleKey)) {
    throw new LocalAppEnvError("invalid_service_key", "Supabase service role key is invalid")
  }

  return { apiUrl: apiUrl.toString().replace(/\/$/, ""), anonKey, serviceRoleKey }
}

function requiredStatusString(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new LocalAppEnvError(
      "missing_status_field",
      `Local Supabase status is missing ${fieldName}`,
    )
  }
  return value
}

function isLocalAnonKey(value) {
  return /^sb_publishable_[A-Za-z0-9_-]+$/.test(value) || isJwt(value)
}

function isLocalServiceKey(value) {
  return /^sb_secret_[A-Za-z0-9_-]+$/.test(value) || isJwt(value)
}

function isJwt(value) {
  return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

class LocalAppEnvError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LocalAppEnvError"
    this.code = code
  }
}
