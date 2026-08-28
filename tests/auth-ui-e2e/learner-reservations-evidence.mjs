import { randomBytes } from "node:crypto"
import { lstat, mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { createVersionBundle } from "./learner-reservations-evidence-bundle.mjs"
import { commitCurrentPointer, publicationPaths } from "./learner-reservations-evidence-paths.mjs"
import {
  cleanupSupersededVersions,
  preparePublicationTopology,
} from "./learner-reservations-evidence-topology.mjs"
import { validatePublication } from "./learner-reservations-evidence-validation.mjs"
import { createOwnedTempRoot } from "./owned-temp-root.mjs"

export async function createLearnerReservationEvidenceWorkspace() {
  const owner = await createOwnedTempRoot({ prefix: "spolink-task6-evidence-" })
  const workspace = await owner.createDirectory("workspace")
  const stagedScreenshotsDir = path.join(workspace.path, "screenshots")
  const stagedSummaryPath = path.join(workspace.path, "focused-summary.json")
  await mkdir(stagedScreenshotsDir, { mode: 0o700 })
  let closed = false

  return Object.freeze({
    runId: `run-${Date.now().toString(36)}-${randomBytes(12).toString("hex")}`,
    stagedScreenshotsDir,
    stagedSummaryPath,
    async cleanup() {
      if (closed) return
      await removeOwnedNestedPath(stagedScreenshotsDir, "directory")
      await removeOwnedNestedPath(stagedSummaryPath, "file")
      await owner.remove(workspace)
      await owner.cleanup()
      closed = true
    },
  })
}

export async function publishLearnerReservationEvidence({
  outputPath,
  publicationHooks = null,
  stagedScreenshotsDir,
  stagedSummaryPath,
  visualDir,
}) {
  const summary = await validatePublication(stagedScreenshotsDir, stagedSummaryPath, true)
  const paths = publicationPaths(outputPath, visualDir)
  await preparePublicationTopology(paths)
  const bundlePath = await createVersionBundle({
    paths,
    stagedScreenshotsDir,
    stagedSummaryPath,
    summary,
  })
  await commitCurrentPointer(paths, summary.runId, bundlePath, publicationHooks)
  await cleanupSupersededVersions(paths, bundlePath)
  return summary
}

async function removeOwnedNestedPath(candidate, expectedType) {
  try {
    const stats = await lstat(candidate)
    const typeMatches = expectedType === "file" ? stats.isFile() : stats.isDirectory()
    if (stats.isSymbolicLink() || !typeMatches) {
      throw new Error(`Task 6 staged ${expectedType} identity changed`)
    }
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  await rm(candidate, { recursive: expectedType === "directory" })
}
