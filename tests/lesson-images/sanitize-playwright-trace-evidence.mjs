import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { independentlyScanPlaywrightTrace } from "./playwright-trace-security-scan.mjs"
import { redactPlaywrightTrace } from "./redact-playwright-trace.mjs"
import {
  auditTraceHashReferences,
  refreshTraceHashReferences,
} from "./trace-evidence-references.mjs"

const outputPath = path.resolve(process.argv[2] ?? "")
if (!process.argv[2]) throw new TypeError("Security migration output path is required")

const repoRoot = process.cwd()
const evidenceRoots = [
  ".omo/evidence/lesson-image-upload/task-7",
  ".omo/evidence/lesson-image-upload/task-10",
]
const startedAt = new Date()
const archives = []
for (const root of evidenceRoots) {
  archives.push(...(await collectFiles(path.join(repoRoot, root), (file) => file.endsWith(".zip"))))
}
archives.sort()
const inventory = []

for (const [index, archivePath] of archives.entries()) {
  const beforeBytes = await readFile(archivePath)
  const result = await redactPlaywrightTrace(archivePath)
  const independent = result.independentScan
  assert.equal(independent.forbiddenPatternMatches, 0)
  const afterBytes = await readFile(archivePath)
  inventory.push({
    afterForbiddenMatches: independent.forbiddenPatternMatches,
    afterSha256: sha256(afterBytes),
    beforeForbiddenMatches: result.preSanitizationForbiddenPatternMatches,
    beforeSha256: sha256(beforeBytes),
    binaryEntriesPreserved: result.binaryEntriesPreserved,
    bytesAfter: afterBytes.length,
    bytesBefore: beforeBytes.length,
    changedTextEntries: result.changedTextEntries,
    entriesScanned: result.entriesScanned,
    path: path.relative(repoRoot, archivePath),
    textualEntriesProcessed: result.textualEntriesProcessed,
  })
  process.stdout.write(
    `${JSON.stringify({
      afterForbiddenMatches: independent.forbiddenPatternMatches,
      beforeForbiddenMatches: result.preSanitizationForbiddenPatternMatches,
      index: index + 1,
      total: archives.length,
    })}\n`,
  )
}

const referenceRefresh = await refreshJsonEvidence(inventory)
await refreshTimestampProvenance(inventory, new Date())

const finalScans = []
for (const archive of inventory) {
  const scan = await independentlyScanPlaywrightTrace(path.join(repoRoot, archive.path))
  assert.equal(scan.forbiddenPatternMatches, 0)
  finalScans.push({
    binaryEntries: scan.binaryEntries,
    entriesScanned: scan.entriesScanned,
    forbiddenPatternMatches: scan.forbiddenPatternMatches,
    path: archive.path,
    textualEntries: scan.textualEntries,
  })
}

const finishedAt = new Date()
const referenceAudit = await auditTraceHashReferences({
  evidenceRoots: evidenceRoots.map((root) => path.join(repoRoot, root)),
  repoRoot,
})
assert.equal(referenceAudit.mismatches, 0)
assert.equal(referenceAudit.missingArchives, 0)
assert.equal(referenceAudit.unresolvedPaths, 0)
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      archiveCount: inventory.length,
      archives: inventory,
      finalIndependentScan: {
        archiveCount: finalScans.length,
        archives: finalScans,
        forbiddenPatternMatches: finalScans.reduce(
          (total, scan) => total + scan.forbiddenPatternMatches,
          0,
        ),
      },
      finishedAtUtc: finishedAt.toISOString(),
      oldToNewHashMultimap: buildOldToNewHashMultimap(inventory),
      referenceAudit: {
        exactPathHashMatches: referenceAudit.exactPathHashMatches,
        mismatches: referenceAudit.mismatches,
        missingArchives: referenceAudit.missingArchives,
        referenceCount: referenceAudit.referenceCount,
        unresolvedPaths: referenceAudit.unresolvedPaths,
      },
      referenceRefresh,
      startedAtUtc: startedAt.toISOString(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
)

async function refreshJsonEvidence(archiveInventory) {
  for (const archive of archiveInventory) {
    await refreshLocalTraceReport(archive)
  }
  return refreshTraceHashReferences({
    archiveInventory,
    evidenceRoots: evidenceRoots.map((root) => path.join(repoRoot, root)),
    repoRoot,
  })
}

async function refreshLocalTraceReport(archive) {
  const archivePath = path.join(repoRoot, archive.path)
  const directory = path.dirname(archivePath)
  const reportNames = archive.path.endsWith("task-7-lesson-image-upload.zip")
    ? ["browser-qa.json"]
    : (await readdir(directory)).filter((name) => name.startsWith("public-gallery-browser-report"))
  for (const reportName of reportNames) {
    const reportPath = path.join(directory, reportName)
    try {
      const report = JSON.parse(await readFile(reportPath, "utf8"))
      report.traceRedaction = {
        archivePath: archive.path,
        binaryEntriesPreserved: archive.binaryEntriesPreserved,
        changedTextEntries: archive.changedTextEntries,
        entriesScanned: archive.entriesScanned,
        forbiddenPatternMatches: archive.afterForbiddenMatches,
        independentScan: { forbiddenPatternMatches: archive.afterForbiddenMatches },
        preSanitizationForbiddenPatternMatches: archive.beforeForbiddenMatches,
        sha256: archive.afterSha256,
        textualEntriesProcessed: archive.textualEntriesProcessed,
      }
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

function buildOldToNewHashMultimap(archiveInventory) {
  const multimap = new Map()
  for (const archive of archiveInventory) {
    const records = multimap.get(archive.beforeSha256) ?? []
    records.push({ afterSha256: archive.afterSha256, path: archive.path })
    multimap.set(archive.beforeSha256, records)
  }
  return [...multimap]
    .map(([beforeSha256, records]) => ({
      beforeSha256,
      records: records.sort((left, right) => left.path.localeCompare(right.path)),
    }))
    .sort((left, right) => left.beforeSha256.localeCompare(right.beforeSha256))
}

async function refreshTimestampProvenance(archiveInventory, sanitizedAt) {
  const byTopLevelDirectory = new Map()
  for (const archive of archiveInventory) {
    const parts = archive.path.split("/")
    if (parts[3] !== "task-10" || parts.length < 5) continue
    const directory = parts.slice(0, 5).join("/")
    const current = byTopLevelDirectory.get(directory) ?? []
    current.push(archive.path)
    byTopLevelDirectory.set(directory, current)
  }
  for (const [directory, archivePaths] of byTopLevelDirectory) {
    const provenancePath = path.join(repoRoot, directory, "timestamp-provenance.json")
    try {
      const provenance = JSON.parse(await readFile(provenancePath, "utf8"))
      for (const artifact of provenance.artifactMtimes ?? []) {
        const artifactPath = path.join(repoRoot, directory, artifact.path)
        const metadata = await stat(artifactPath)
        artifact.bytes = metadata.size
        artifact.mtimeUtc = metadata.mtime.toISOString()
      }
      provenance.securityRemediation = {
        archivesRewritten: archivePaths.length,
        authorizedPostRunMutation: true,
        forbiddenPatternMatchesAfter: 0,
        sanitizedAtUtc: sanitizedAt.toISOString(),
      }
      provenance.conflictingMtimes = []
      provenance.filesystemMtimeConflict = false
      await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 })
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

async function collectFiles(directory, predicate) {
  const files = []
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await collectFiles(target, predicate)))
      else if (entry.isFile() && predicate(target)) files.push(target)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  return files
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
