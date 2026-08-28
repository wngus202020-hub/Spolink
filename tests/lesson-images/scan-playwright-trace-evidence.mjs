import assert from "node:assert/strict"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  decodeScannableText,
  independentlyScanPlaywrightTrace,
  independentlyScanText,
} from "./playwright-trace-security-scan.mjs"

const outputPath = path.resolve(process.argv[2] ?? "")
if (!process.argv[2]) throw new TypeError("Independent scan output path is required")

const repoRoot = process.cwd()
const roots = [
  ".omo/evidence/lesson-image-upload/task-7",
  ".omo/evidence/lesson-image-upload/task-10",
]
const archives = []
const allFiles = []
for (const root of roots) {
  allFiles.push(...(await collectFiles(path.join(repoRoot, root))))
}
archives.push(...allFiles.filter((file) => file.endsWith(".zip")))
archives.sort()
const inventory = await mapWithConcurrency(archives, 4, async (archivePath) => {
  const scan = await independentlyScanPlaywrightTrace(archivePath)
  return {
    binaryEntries: scan.binaryEntries,
    entriesScanned: scan.entriesScanned,
    forbiddenPatternMatches: scan.forbiddenPatternMatches,
    path: path.relative(repoRoot, archivePath),
    textualEntries: scan.textualEntries,
  }
})
const forbiddenPatternMatches = inventory.reduce(
  (total, archive) => total + archive.forbiddenPatternMatches,
  0,
)
const nonZipInventory = []
let nonZipBinaryFiles = 0
for (const file of allFiles.filter((candidate) => !candidate.endsWith(".zip")).sort()) {
  const source = decodeScannableText(await readFile(file))
  if (source === null) {
    nonZipBinaryFiles += 1
    continue
  }
  const scan = independentlyScanText(source)
  nonZipInventory.push({
    forbiddenPatternMatches: scan.forbiddenPatternMatches,
    path: path.relative(repoRoot, file),
  })
}
const nonZipForbiddenPatternMatches = nonZipInventory.reduce(
  (total, file) => total + file.forbiddenPatternMatches,
  0,
)
assert.equal(forbiddenPatternMatches + nonZipForbiddenPatternMatches, 0)
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      archiveCount: inventory.length,
      archives: inventory,
      forbiddenPatternMatches,
      nonZipBinaryFiles,
      nonZipForbiddenPatternMatches,
      nonZipTextFiles: nonZipInventory.length,
      scannedAtUtc: new Date().toISOString(),
      scanner: "independent all-entry UTF-8/UTF-16 detection and superset pattern scan",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
)
process.stdout.write(
  `${JSON.stringify({
    archiveCount: inventory.length,
    forbiddenPatternMatches,
    nonZipForbiddenPatternMatches,
  })}\n`,
)

async function collectFiles(directory) {
  const files = []
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) files.push(...(await collectFiles(target)))
      else if (entry.isFile()) files.push(target)
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  return files
}

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await callback(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker))
  return results
}
