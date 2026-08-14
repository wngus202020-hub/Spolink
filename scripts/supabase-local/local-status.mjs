import process from "node:process"

import { PROJECT_ID, statusArgs } from "./constants.mjs"
import { assertSafeParentEnv, createSupabaseSealedEnv } from "./env.mjs"
import { runSpawn } from "./spawn.mjs"
import { assertSafeLocalConfig, parseSupabaseStatus } from "./status-config.mjs"

export class LocalSupabaseNotRunningError extends Error {
  constructor() {
    super("Local Supabase runtime is not running")
    this.name = "LocalSupabaseNotRunningError"
    this.code = "supabase_not_running"
  }
}

export async function readGuardedLocalStatus({
  repoRoot = process.cwd(),
  env = process.env,
  spawnRunner = runSpawn,
  statusJson,
  projectId = PROJECT_ID,
} = {}) {
  assertSafeParentEnv(env)
  await assertSafeLocalConfig(repoRoot)
  let output = statusJson
  if (output === undefined) {
    const spec = {
      command: "corepack",
      args: ["pnpm", "exec", "supabase", ...statusArgs],
      options: {
        cwd: repoRoot,
        shell: false,
        env: createSupabaseSealedEnv(env),
      },
      timeoutMs: 180_000,
    }
    const result = await spawnRunner(spec)
    if (isVerifiedNotRunningResult(result, projectId)) {
      throw new LocalSupabaseNotRunningError()
    }
    if (result.exitCode !== 0) {
      throw new Error(`${spec.command} ${spec.args.join(" ")} failed with exit ${result.exitCode}`)
    }
    output = result.stdout
  }

  const parsed = parseSupabaseStatus(output, { projectId })
  const raw = JSON.parse(output)
  return {
    projectId,
    apiUrl: parsed.apiUrl.toString().replace(/\/$/, ""),
    dbUrl: parsed.dbUrl.toString(),
    anonKey: raw[parsed.clientKeyName],
    serviceRoleKey: raw[parsed.serviceKeyName],
    redacted: parsed.redacted,
  }
}

function isVerifiedNotRunningResult(result, projectId) {
  if (result.exitCode !== 1) return false
  const signature =
    `failed to inspect container health: Error response from daemon: ` +
    `No such container: supabase_db_${projectId}`
  return result.stderr.split(/\r?\n/u).some((line) => line.trim() === signature)
}
