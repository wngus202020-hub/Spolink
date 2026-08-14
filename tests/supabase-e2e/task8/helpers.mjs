import path from "node:path"

const baseKeys = ["PATH", "HOME", "TMPDIR"]
const secretPrefixes = ["SUPABASE_", "NEXT_PUBLIC_SUPABASE_"]
const secretKeys = ["SPOLINK_EDGE_SECRET", "TOSS_PAYMENTS_SECRET_KEY"]

export function buildChildEnv(kind, parentEnv = process.env, controls = {}) {
  const env = pickBaseEnv(parentEnv)
  if (kind === "next-unconfigured") return env
  if (kind === "next-configured") {
    requireControl(controls, "apiUrl")
    requireControl(controls, "anonKey")
    return {
      ...env,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: controls.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: controls.apiUrl,
    }
  }
  if (kind === "test-api")
    return { ...env, NODE_ENV: "test", SPOLINK_TEST_BASE_URL: controls.baseUrl }
  if (kind === "supabase-command") return env
  if (kind === "typecheck" || kind === "lint") return { ...env, NODE_ENV: "test" }
  if (kind === "build") return { ...env, NODE_ENV: "production" }
  if (kind === "e2e") return buildE2eEnv(env, controls)
  throw new Error(`Unknown Todo8 child env kind: ${kind}`)
}

export function assertQaHoldRequest({ metadataPath, repoRoot = process.cwd(), seconds } = {}) {
  if (seconds === undefined || seconds === "" || seconds === null) return { enabled: false }
  if (seconds !== "120" && seconds !== 120) throw new Error("QA hold only accepts 120 seconds")
  if (typeof metadataPath !== "string" || !path.isAbsolute(metadataPath)) {
    throw new Error("QA metadata path must be absolute")
  }
  const relative = path.relative(repoRoot, metadataPath)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("QA metadata path must be outside the repository")
  }
  return { enabled: true, metadataPath, seconds: 120 }
}

export function assertSingleOwnedNext(children) {
  const live = children.filter((child) => !child.stopped)
  if (live.length > 1) throw new Error("Todo8 may own at most one Next child at a time")
}

export function assertNoSecretKeys(env) {
  for (const key of Object.keys(env)) {
    if (secretKeys.includes(key) || secretPrefixes.some((prefix) => key.startsWith(prefix))) {
      throw new Error(`Secret or disallowed public key leaked into child env: ${key}`)
    }
  }
}

function buildE2eEnv(env, controls) {
  requireControl(controls, "baseUrl")
  const result = { ...env, NODE_ENV: "test", SPOLINK_TEST_BASE_URL: controls.baseUrl }
  for (const key of [
    "SPOLINK_E2E_FORCE_LOCK_TIMEOUT",
    "SPOLINK_E2E_INJECT_FAILURE",
    "SPOLINK_E2E_QA_HOLD_SECONDS",
    "SPOLINK_E2E_QA_METADATA",
  ]) {
    if (typeof controls[key] === "string" && controls[key].length > 0) result[key] = controls[key]
  }
  return result
}

function pickBaseEnv(parentEnv) {
  const env = {}
  for (const key of baseKeys) {
    if (typeof parentEnv[key] !== "string" || parentEnv[key].length === 0) {
      throw new Error(`Missing required child env key: ${key}`)
    }
    env[key] = parentEnv[key]
  }
  return env
}

function requireControl(controls, key) {
  if (typeof controls[key] !== "string" || controls[key].length === 0) {
    throw new Error(`Missing Todo8 control: ${key}`)
  }
}
