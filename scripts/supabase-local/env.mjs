import { existsSync } from "node:fs"
import path from "node:path"
import process from "node:process"

export function createDockerEnv(parentEnv = process.env) {
  assertSafeParentEnv(parentEnv)
  return withDockerCliPath(pickRequiredEnv(parentEnv, ["PATH", "HOME", "TMPDIR"]))
}

export function createSupabaseSealedEnv(parentEnv = process.env) {
  assertSafeParentEnv(parentEnv)
  return {
    ...withDockerCliPath(pickRequiredEnv(parentEnv, ["PATH", "HOME", "TMPDIR"])),
    SUPABASE_TELEMETRY_DISABLED: "1",
  }
}

export function assertSafeParentEnv(parentEnv) {
  for (const key of Object.keys(parentEnv)) {
    if (key === "DOCKER_HOST" || key === "DOCKER_CONTEXT" || key.startsWith("SUPABASE_")) {
      throw new Error(`Unsafe inherited environment variable: ${key}`)
    }
  }
}

export function findDockerAppPath(env = process.env) {
  const candidates = [
    "/Applications/Docker.app",
    env.HOME ? path.join(env.HOME, "Applications", "Docker.app") : null,
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function pickRequiredEnv(parentEnv, keys) {
  const result = {}
  for (const key of keys) {
    if (typeof parentEnv[key] !== "string" || parentEnv[key].length === 0) {
      throw new Error(`Missing required environment variable: ${key}`)
    }
    result[key] = parentEnv[key]
  }
  return result
}

function withDockerCliPath(env) {
  const appPath = findDockerAppPath(env)
  if (!appPath) {
    return env
  }
  return {
    ...env,
    PATH: `${path.join(appPath, "Contents", "Resources", "bin")}:${env.PATH}`,
  }
}
