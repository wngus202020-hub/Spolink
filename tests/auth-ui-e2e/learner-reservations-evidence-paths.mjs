import { randomBytes } from "node:crypto"
import { lstat, readFile, readlink, realpath, rename, rm, symlink } from "node:fs/promises"
import path from "node:path"

import { screenshotDescriptors, sha256 } from "./learner-reservations-evidence-validation.mjs"

export function publicationPaths(outputPath, visualDir) {
  const root = path.resolve(path.dirname(outputPath))
  if (
    path.resolve(path.dirname(visualDir)) !== root ||
    path.basename(outputPath) !== "focused-summary.json" ||
    path.basename(visualDir) !== "screenshots"
  ) {
    throw new Error("Task 6 canonical paths must share the expected evidence directory")
  }
  return {
    current: path.join(root, "current"),
    outputPath: path.resolve(outputPath),
    root,
    versionsRoot: path.join(root, "versions"),
    visualDir: path.resolve(visualDir),
  }
}

export async function commitCurrentPointer(paths, runId, bundlePath, publicationHooks) {
  await publicationHooks?.beforePointerSwap?.()
  const pointerCandidate = path.join(paths.root, `.current-${randomBytes(12).toString("hex")}`)
  await symlink(path.join("versions", runId), pointerCandidate)
  try {
    await validatePointer(pointerCandidate, paths.versionsRoot, bundlePath)
    await rename(pointerCandidate, paths.current)
  } finally {
    await rm(pointerCandidate, { force: true })
  }
  await publicationHooks?.afterPointerSwap?.()
  await validateCanonicalTopology(paths)
}

export async function installInitialPointer(paths, runId, bundlePath) {
  const candidate = path.join(paths.root, `.current-${randomBytes(12).toString("hex")}`)
  await symlink(path.join("versions", runId), candidate)
  try {
    await validatePointer(candidate, paths.versionsRoot, bundlePath)
    await rename(candidate, paths.current)
  } finally {
    await rm(candidate, { force: true })
  }
}

export async function ensureCanonicalLink(canonicalPath, expectedTarget, currentPath) {
  try {
    const stats = await lstat(canonicalPath)
    if (stats.isSymbolicLink()) {
      if ((await readlink(canonicalPath)) !== expectedTarget) {
        throw new Error(`Task 6 canonical link target changed: ${canonicalPath}`)
      }
      await assertRealpathInside(await realpath(canonicalPath), await realpath(currentPath))
      return
    }
    if (!stats.isFile() || stats.nlink !== 1 || (stats.mode & 0o777) !== 0o600) {
      throw new Error(`Task 6 canonical file identity changed: ${canonicalPath}`)
    }
    const currentTarget = path.resolve(path.dirname(canonicalPath), expectedTarget)
    if (sha256(await readFile(canonicalPath)) !== sha256(await readFile(currentTarget))) {
      throw new Error(`Task 6 canonical migration bytes changed: ${canonicalPath}`)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  const candidate = `${canonicalPath}.task6-link-${randomBytes(8).toString("hex")}`
  await symlink(expectedTarget, candidate)
  try {
    await rename(candidate, canonicalPath)
  } finally {
    await rm(candidate, { force: true })
  }
}

export async function validateCanonicalTopology(paths) {
  const bundlePath = await validatePointer(paths.current, paths.versionsRoot)
  await validateCanonicalLink(
    paths.outputPath,
    path.join("current", "focused-summary.json"),
    bundlePath,
  )
  for (const [name] of screenshotDescriptors) {
    await validateCanonicalLink(
      path.join(paths.visualDir, name),
      path.join("..", "current", "screenshots", name),
      bundlePath,
    )
  }
  return bundlePath
}

export async function validatePointer(pointerPath, versionsRoot, expectedBundle = null) {
  const stats = await lstat(pointerPath)
  if (!stats.isSymbolicLink()) throw new Error("Task 6 current pointer must be a symlink")
  const target = await readlink(pointerPath)
  if (!target.startsWith(`versions${path.sep}`) || path.isAbsolute(target)) {
    throw new Error("Task 6 current pointer target changed")
  }
  const resolved = await realpath(pointerPath)
  const realVersionsRoot = await realpath(versionsRoot)
  await assertRealpathInside(resolved, realVersionsRoot)
  if (expectedBundle && resolved !== (await realpath(expectedBundle))) {
    throw new Error("Task 6 current pointer resolved to the wrong bundle")
  }
  return resolved
}

export async function assertRealpathInside(candidate, root) {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error("Task 6 evidence target escaped the owned versions root")
  }
}

async function validateCanonicalLink(canonicalPath, expectedTarget, bundlePath) {
  const stats = await lstat(canonicalPath)
  if (!stats.isSymbolicLink() || (await readlink(canonicalPath)) !== expectedTarget) {
    throw new Error(`Task 6 canonical symlink changed: ${canonicalPath}`)
  }
  await assertRealpathInside(await realpath(canonicalPath), bundlePath)
}
