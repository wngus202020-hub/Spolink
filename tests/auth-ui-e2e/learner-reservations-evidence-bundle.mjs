import { randomBytes } from "node:crypto"
import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"

import {
  screenshotDescriptors,
  validateBundle,
  writeBundleManifest,
} from "./learner-reservations-evidence-validation.mjs"

export async function createVersionBundle({
  paths,
  stagedScreenshotsDir,
  stagedSummaryPath,
  summary,
}) {
  const bundlePath = path.join(paths.versionsRoot, summary.runId)
  await assertAbsent(bundlePath, "Task 6 run bundle already exists")
  const stagingPath = path.join(
    paths.versionsRoot,
    `.staging-${summary.runId}-${randomBytes(8).toString("hex")}`,
  )
  await mkdir(stagingPath, { mode: 0o700 })
  try {
    const screenshotsPath = path.join(stagingPath, "screenshots")
    const summaryPath = path.join(stagingPath, "focused-summary.json")
    await rename(stagedScreenshotsDir, screenshotsPath)
    await rename(stagedSummaryPath, summaryPath)
    await chmod(screenshotsPath, 0o700)
    await chmod(summaryPath, 0o600)
    await writeBundleManifest(stagingPath, summary)
    await validateBundle(stagingPath, summary.runId)
    await rename(stagingPath, bundlePath)
    return bundlePath
  } catch (error) {
    await removeOwnedStagingPath(stagingPath)
    throw error
  }
}

export async function copyLegacyBundle(paths, bundlePath, runId, summary) {
  const stagingPath = path.join(
    paths.versionsRoot,
    `.staging-${runId}-${randomBytes(8).toString("hex")}`,
  )
  await mkdir(path.join(stagingPath, "screenshots"), { mode: 0o700, recursive: true })
  try {
    for (const [name] of screenshotDescriptors) {
      const destination = path.join(stagingPath, "screenshots", name)
      await copyFile(path.join(paths.visualDir, name), destination)
      await chmod(destination, 0o600)
    }
    const summaryPath = path.join(stagingPath, "focused-summary.json")
    await copyFile(paths.outputPath, summaryPath)
    await chmod(summaryPath, 0o600)
    await writeBundleManifest(stagingPath, { ...summary, runId })
    await rename(stagingPath, bundlePath)
  } catch (error) {
    await removeOwnedStagingPath(stagingPath)
    throw error
  }
}

async function removeOwnedStagingPath(candidate) {
  try {
    const stats = await lstat(candidate)
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !path.basename(candidate).startsWith(".staging-")
    ) {
      throw new Error("Task 6 staging identity changed")
    }
    await rm(candidate, { recursive: true })
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

async function assertAbsent(candidate, message) {
  try {
    await lstat(candidate)
    throw new Error(message)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}
