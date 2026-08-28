import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import { copyLegacyBundle } from "./learner-reservations-evidence-bundle.mjs"
import {
  assertRealpathInside,
  ensureCanonicalLink,
  installInitialPointer,
  validateCanonicalTopology,
  validatePointer,
} from "./learner-reservations-evidence-paths.mjs"
import {
  runIdPattern,
  screenshotDescriptors,
  sha256,
  validatePublication,
} from "./learner-reservations-evidence-validation.mjs"

const ownerMarkerName = ".spolink-evidence-owner"
const ownerMarker = "SPOLINK learner reservation evidence versions v1\n"

export async function preparePublicationTopology(paths) {
  await mkdir(paths.root, { mode: 0o700, recursive: true })
  await ensureOwnedVersionsRoot(paths)
  await bootstrapCanonicalTopology(paths)
  if (await pathExists(paths.current)) await validateCanonicalTopology(paths)
  await validateVersionsInventory(paths)
}

export async function cleanupSupersededVersions(paths, currentBundle) {
  await validateVersionsInventory(paths)
  const realCurrentBundle = await realpath(currentBundle)
  for (const entry of await readdir(paths.versionsRoot, { withFileTypes: true })) {
    if (entry.name === ownerMarkerName) continue
    const entryPath = path.join(paths.versionsRoot, entry.name)
    if ((await realpath(entryPath)) === realCurrentBundle) continue
    await rm(entryPath, { recursive: true })
  }
}

async function ensureOwnedVersionsRoot(paths) {
  try {
    const stats = await lstat(paths.versionsRoot)
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700) {
      throw new Error("Task 6 owned versions root type or mode changed")
    }
    const markerPath = path.join(paths.versionsRoot, ownerMarkerName)
    const markerStats = await lstat(markerPath)
    if (
      !markerStats.isFile() ||
      markerStats.isSymbolicLink() ||
      markerStats.nlink !== 1 ||
      (markerStats.mode & 0o777) !== 0o600 ||
      (await readFile(markerPath, "utf8")) !== ownerMarker
    ) {
      throw new Error("Task 6 owned versions marker changed")
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
    await mkdir(paths.versionsRoot, { mode: 0o700 })
    await writeFile(path.join(paths.versionsRoot, ownerMarkerName), ownerMarker, {
      flag: "wx",
      mode: 0o600,
    })
  }
}

async function bootstrapCanonicalTopology(paths) {
  if (await pathExists(paths.current)) {
    await validatePointer(paths.current, paths.versionsRoot)
  } else if (!(await canonicalLinksArePrepared(paths)) && (await legacyCanonicalExists(paths))) {
    const legacySummary = await validatePublication(paths.visualDir, paths.outputPath, false)
    const summaryHash = sha256(await readFile(paths.outputPath))
    const migrationRunId = runIdPattern.test(legacySummary.runId ?? "")
      ? legacySummary.runId
      : `migration-${summaryHash.slice(0, 24)}`
    const migrationBundle = path.join(paths.versionsRoot, migrationRunId)
    if (!(await pathExists(migrationBundle))) {
      await copyLegacyBundle(paths, migrationBundle, migrationRunId, legacySummary)
    }
    await installInitialPointer(paths, migrationRunId, migrationBundle)
  }

  await mkdir(paths.visualDir, { mode: 0o700, recursive: true })
  const visualStats = await lstat(paths.visualDir)
  if (!visualStats.isDirectory() || visualStats.isSymbolicLink()) {
    throw new Error("Task 6 canonical screenshot directory must be real")
  }
  await chmod(paths.visualDir, 0o700)
  await ensureCanonicalLink(
    paths.outputPath,
    path.join("current", "focused-summary.json"),
    paths.current,
  )
  for (const [name] of screenshotDescriptors) {
    await ensureCanonicalLink(
      path.join(paths.visualDir, name),
      path.join("..", "current", "screenshots", name),
      paths.current,
    )
  }
}

async function canonicalLinksArePrepared(paths) {
  try {
    const visualStats = await lstat(paths.visualDir)
    const summaryStats = await lstat(paths.outputPath)
    if (
      !visualStats.isDirectory() ||
      visualStats.isSymbolicLink() ||
      !summaryStats.isSymbolicLink() ||
      (await readlink(paths.outputPath)) !== path.join("current", "focused-summary.json")
    ) {
      return false
    }
    for (const [name] of screenshotDescriptors) {
      const screenshotPath = path.join(paths.visualDir, name)
      const stats = await lstat(screenshotPath)
      if (
        !stats.isSymbolicLink() ||
        (await readlink(screenshotPath)) !== path.join("..", "current", "screenshots", name)
      ) {
        return false
      }
    }
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}

async function legacyCanonicalExists(paths) {
  const outputExists = await pathExists(paths.outputPath)
  const visualExists = await pathExists(paths.visualDir)
  if (outputExists !== visualExists) {
    throw new Error("Task 6 legacy canonical publication is incomplete")
  }
  return outputExists
}

async function validateVersionsInventory(paths) {
  const realVersionsRoot = await realpath(paths.versionsRoot)
  for (const entry of await readdir(paths.versionsRoot, { withFileTypes: true })) {
    if (entry.name === ownerMarkerName) continue
    if (
      (!runIdPattern.test(entry.name) && !entry.name.startsWith(".staging-")) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    ) {
      throw new Error(`Task 6 owned versions inventory changed: ${entry.name}`)
    }
    const entryPath = path.join(paths.versionsRoot, entry.name)
    const stats = await lstat(entryPath)
    if ((stats.mode & 0o777) !== 0o700) {
      throw new Error(`Task 6 owned version mode changed: ${entry.name}`)
    }
    await assertRealpathInside(await realpath(entryPath), realVersionsRoot)
  }
}

async function pathExists(candidate) {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw error
  }
}
