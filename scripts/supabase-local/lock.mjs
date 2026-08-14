import { mkdir, open, readFile, rm } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { RUNTIME_LOCK_FILENAME } from "./constants.mjs"
import { isPlainObject } from "./utils.mjs"

export function runtimeLockPath(receiptPath) {
  return path.join(path.dirname(receiptPath), RUNTIME_LOCK_FILENAME)
}

export async function withRuntimeLock(lockPath, action) {
  await mkdir(path.dirname(lockPath), { recursive: true })
  const acquisition = await acquireRuntimeLock(lockPath)
  const { handle } = acquisition
  try {
    await handle.writeFile(
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
    )
    await handle.chmod(0o600)
    return await action({ recoveredStaleLock: acquisition.recoveredStaleLock })
  } finally {
    await handle.close()
    await rm(lockPath, { force: true })
  }
}

async function acquireRuntimeLock(lockPath) {
  let recoveredStaleLock = null
  for (const allowStaleRecovery of [true, false]) {
    try {
      return { handle: await open(lockPath, "wx", 0o600), recoveredStaleLock }
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error
      }
      const staleOwner = allowStaleRecovery ? await removeStaleRuntimeLock(lockPath) : null
      if (staleOwner) {
        recoveredStaleLock = staleOwner.pid === 0 ? null : staleOwner
        continue
      }
      throw new Error("Another Supabase lifecycle start is in progress")
    }
  }
  throw new Error("Another Supabase lifecycle start is in progress")
}

async function removeStaleRuntimeLock(lockPath) {
  const owner = await readRuntimeLockOwner(lockPath)
  if (owner.pid === 0) {
    return owner
  }
  if (isProcessAlive(owner.pid)) {
    return null
  }
  // Stale-lock recovery is intentionally narrow: remove only the dead owner's lock file.
  // Runtime directories remain governed by the lifecycle start path while the new lock is held.
  await rm(lockPath)
  return owner
}

async function readRuntimeLockOwner(lockPath) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"))
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { pid: 0 }
    }
    throw new Error("Existing Supabase lifecycle lock is invalid")
  }
  if (
    !isPlainObject(parsed) ||
    Object.keys(parsed).sort().join(",") !== "createdAt,pid" ||
    !Number.isInteger(parsed.pid) ||
    parsed.pid <= 0 ||
    typeof parsed.createdAt !== "string" ||
    !Number.isFinite(Date.parse(parsed.createdAt))
  ) {
    throw new Error("Existing Supabase lifecycle lock is invalid")
  }
  return parsed
}

function isProcessAlive(pid) {
  if (pid === 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false
    }
    return true
  }
}
