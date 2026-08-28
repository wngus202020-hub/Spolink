import { lstat, readdir, rm, rmdir } from "node:fs/promises"
import path from "node:path"

export async function snapshotSupabaseCliTemp(repoRoot = process.cwd()) {
  const tempDir = path.join(repoRoot, "supabase", ".temp")
  const marker = path.join(tempDir, "cli-latest")
  return {
    marker,
    markerExisted: (await optionalLstat(marker)) !== null,
    repoRoot,
    schemaVersion: 1,
    tempDir,
    tempDirExisted: (await optionalLstat(tempDir)) !== null,
  }
}

export async function cleanupRunnerCreatedSupabaseCliTemp(snapshot) {
  assertSnapshot(snapshot)
  if (snapshot.markerExisted) {
    return {
      markerPreexisted: true,
      remainingEntries: await readRemainingEntries(snapshot.tempDir),
      removedEmptyTempDir: false,
      removedMarker: false,
      tempDirPreexisted: snapshot.tempDirExisted,
      verdict: "APPROVE",
    }
  }
  const markerStats = await optionalLstat(snapshot.marker)
  if (!markerStats) {
    return {
      markerPreexisted: false,
      remainingEntries: await readRemainingEntries(snapshot.tempDir),
      removedEmptyTempDir: false,
      removedMarker: false,
      tempDirPreexisted: snapshot.tempDirExisted,
      verdict: "APPROVE",
    }
  }
  if (!markerStats.isFile()) {
    return {
      markerPreexisted: false,
      remainingEntries: await readRemainingEntries(snapshot.tempDir),
      removedEmptyTempDir: false,
      removedMarker: false,
      tempDirPreexisted: snapshot.tempDirExisted,
      verdict: "REJECT",
    }
  }
  await rm(snapshot.marker)
  const removedEmptyTempDir = await removeTempDirIfRunnerCreatedAndEmpty(snapshot)
  return {
    markerPreexisted: false,
    remainingEntries: await readRemainingEntries(snapshot.tempDir),
    removedEmptyTempDir,
    removedMarker: true,
    tempDirPreexisted: snapshot.tempDirExisted,
    verdict: "APPROVE",
  }
}

export async function assertNoRunnerCreatedSupabaseCliTemp(snapshot) {
  assertSnapshot(snapshot)
  if (!snapshot.markerExisted && (await optionalLstat(snapshot.marker)) !== null) {
    throw new Error(`Runner-owned Supabase CLI temp residue still exists: ${snapshot.marker}`)
  }
}

async function removeTempDirIfRunnerCreatedAndEmpty(snapshot) {
  if (snapshot.tempDirExisted) return false
  try {
    if ((await readdir(snapshot.tempDir)).length > 0) return false
    await rmdir(snapshot.tempDir)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function readRemainingEntries(tempDir) {
  try {
    return (await readdir(tempDir)).sort()
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw error
  }
}

function assertSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== 1 ||
    typeof snapshot.repoRoot !== "string" ||
    typeof snapshot.marker !== "string" ||
    typeof snapshot.tempDir !== "string" ||
    typeof snapshot.markerExisted !== "boolean" ||
    typeof snapshot.tempDirExisted !== "boolean"
  ) {
    throw new Error("Invalid Supabase CLI temp ownership snapshot")
  }
}

async function optionalLstat(filePath) {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}
