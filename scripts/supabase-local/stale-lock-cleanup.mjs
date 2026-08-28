import { rm } from "node:fs/promises"
import path from "node:path"

import { RUNTIME_DIRS, RUNTIME_LOCK_FILENAME } from "./constants.mjs"

const STALE_LOCK_ORPHAN_RUNTIME_DIRS = ["supabase/.temp", "supabase/.branches"]

export async function removeStaleLockOrphanRuntimeDirs(repoRoot, options) {
  if (!options.staleLockOrphanCleanupAllowed || !options.lockContext?.recoveredStaleLock) {
    return
  }
  assertStaleLockOrphanRuntimeDirScope(repoRoot, options.lockPath)
  for (const rel of STALE_LOCK_ORPHAN_RUNTIME_DIRS) {
    await rm(path.join(repoRoot, rel), { recursive: true, force: true })
  }
}

function assertStaleLockOrphanRuntimeDirScope(repoRoot, lockPath) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new Error("Stale runtime directory cleanup requires a repo root")
  }
  if (path.basename(lockPath) !== RUNTIME_LOCK_FILENAME) {
    throw new Error("Stale runtime directory cleanup requires the guarded runtime lock")
  }
  const repoRootPath = path.resolve(repoRoot)
  for (const rel of STALE_LOCK_ORPHAN_RUNTIME_DIRS) {
    if (!RUNTIME_DIRS.includes(rel)) {
      throw new Error(`Unexpected stale runtime cleanup dir: ${rel}`)
    }
    const target = path.resolve(repoRootPath, rel)
    if (path.isAbsolute(rel) || !target.startsWith(`${repoRootPath}${path.sep}`)) {
      throw new Error(`Unsafe stale runtime cleanup dir: ${rel}`)
    }
  }
}
