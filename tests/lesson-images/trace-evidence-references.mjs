import { createHash } from "node:crypto"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export async function refreshTraceHashReferences(options) {
  const { archiveInventory = [], evidenceRoots, repoRoot } = options
  const inventoryByPath = new Map(archiveInventory.map((archive) => [archive.path, archive]))
  const duplicateOldHashGroups = countDuplicateOldHashes(archiveInventory)
  for (const archive of archiveInventory) {
    const archivePath = resolveInside(repoRoot, archive.path)
    const currentHash = sha256(await readFile(archivePath))
    if (currentHash !== archive.afterSha256) {
      throw new Error(`archive inventory hash mismatch for ${archive.path}`)
    }
  }

  let referencesUpdated = 0
  for (const jsonPath of await collectJsonFiles(evidenceRoots)) {
    const document = JSON.parse(await readFile(jsonPath, "utf8"))
    const references = collectReferences(document, jsonPath, repoRoot)
    let changed = false
    for (const reference of references) {
      const archivePath = resolveReferenceArchive(reference, document, repoRoot)
      if (archivePath === null) {
        throw new Error(
          `${path.relative(repoRoot, jsonPath)} cannot resolve an intended archive path`,
        )
      }
      const relativeArchivePath = path.relative(repoRoot, archivePath)
      const currentHash = sha256(await readFile(archivePath))
      const inventory = inventoryByPath.get(relativeArchivePath)
      if (inventory && inventory.afterSha256 !== currentHash) {
        throw new Error(`path-specific archive hash mismatch for ${relativeArchivePath}`)
      }
      reference.value.archivePath = relativeArchivePath
      reference.value.sha256 = currentHash
      referencesUpdated += 1
      changed = true
    }
    if (changed)
      await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  }
  return { duplicateOldHashGroups, referencesUpdated }
}

export async function auditTraceHashReferences(options) {
  const { evidenceRoots, repoRoot } = options
  const references = []
  let exactPathHashMatches = 0
  let mismatches = 0
  let missingArchives = 0
  let unresolvedPaths = 0
  for (const jsonPath of await collectJsonFiles(evidenceRoots)) {
    const document = JSON.parse(await readFile(jsonPath, "utf8"))
    for (const reference of collectReferences(document, jsonPath, repoRoot)) {
      const archivePath = resolveReferenceArchive(reference, document, repoRoot)
      if (archivePath === null) {
        unresolvedPaths += 1
        references.push(referenceResult(reference, null, false, repoRoot))
        continue
      }
      let exact = false
      try {
        exact = sha256(await readFile(archivePath)) === reference.value.sha256
        if (exact) exactPathHashMatches += 1
        else mismatches += 1
      } catch (error) {
        if (error?.code !== "ENOENT") throw error
        missingArchives += 1
      }
      references.push(referenceResult(reference, archivePath, exact, repoRoot))
    }
  }
  return {
    exactPathHashMatches,
    mismatches,
    missingArchives,
    referenceCount: references.length,
    references,
    unresolvedPaths,
  }
}

function collectReferences(document, jsonPath, repoRoot) {
  const references = []
  visit(document, [], (value, segments) => {
    if (!segments.includes("traceRedaction")) return
    if (value === null || typeof value !== "object" || Array.isArray(value)) return
    if (typeof value.sha256 !== "string") return
    references.push({ jsonPath, repoRoot, segments, value })
  })
  return references
}

function visit(value, segments, callback) {
  callback(value, segments)
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      visit(item, [...segments, index], callback)
    })
    return
  }
  if (value === null || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) visit(item, [...segments, key], callback)
}

function resolveReferenceArchive(reference, document, repoRoot) {
  if (typeof reference.value.archivePath === "string") {
    return resolveInside(repoRoot, reference.value.archivePath)
  }
  const runIndex = reference.segments[0] === "runs" ? reference.segments[1] : null
  const kind = reference.segments.at(-1)
  if (typeof runIndex === "number" && (kind === "authoring" || kind === "public")) {
    const runNumber = document.runs?.[runIndex]?.run
    if (!Number.isInteger(runNumber)) return null
    const fileName =
      kind === "authoring" ? "task-7-lesson-image-upload.zip" : "public-gallery-trace.zip"
    return path.join(path.dirname(reference.jsonPath), `run-${runNumber}`, kind, fileName)
  }
  const directory = path.dirname(reference.jsonPath)
  if (path.basename(directory) === "authoring") {
    return path.join(directory, "task-7-lesson-image-upload.zip")
  }
  if (path.basename(directory) === "public") {
    const candidate = path.join(directory, "public-gallery-trace.zip")
    return path.basename(reference.jsonPath).startsWith("failed-run-") ? null : candidate
  }
  if (path.basename(reference.jsonPath) === "browser-qa.json") {
    return path.join(directory, "task-7-lesson-image-upload.zip")
  }
  return null
}

function resolveInside(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath)
  const relative = path.relative(repoRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative) || !resolved.endsWith(".zip")) {
    throw new Error("trace archive path escapes the evidence repository or is not a ZIP")
  }
  return resolved
}

function referenceResult(reference, archivePath, exact, repoRoot) {
  return {
    archivePath: archivePath ? path.relative(repoRoot, archivePath) : "",
    exact,
    jsonPath: formatJsonPath(reference.segments),
    manifestPath: path.relative(repoRoot, reference.jsonPath),
    sha256: reference.value.sha256,
  }
}

function formatJsonPath(segments) {
  return `$${segments.map((segment) => (typeof segment === "number" ? `[${segment}]` : `.${segment}`)).join("")}`
}

function countDuplicateOldHashes(inventory) {
  const pathsByHash = new Map()
  for (const archive of inventory) {
    const paths = pathsByHash.get(archive.beforeSha256) ?? new Set()
    paths.add(archive.path)
    pathsByHash.set(archive.beforeSha256, paths)
  }
  return [...pathsByHash.values()].filter((paths) => paths.size > 1).length
}

async function collectJsonFiles(roots) {
  const files = []
  for (const root of roots) await collect(root, files)
  return files.sort()
}

async function collect(directory, files) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(target, files)
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(target)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
