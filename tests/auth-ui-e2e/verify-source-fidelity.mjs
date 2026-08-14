#!/usr/bin/env node
import { readFile } from "node:fs/promises"

import { diffSources, readCurrentManifest } from "../supabase-e2e/task8/source-manifest.mjs"

async function main() {
  const [baselinePath, ...summaryPaths] = process.argv.slice(2)
  if (!baselinePath || summaryPaths.length === 0) {
    throw new Error(
      "usage: node tests/auth-ui-e2e/verify-source-fidelity.mjs <baseline> <summary...>",
    )
  }
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"))
  const current = await readCurrentManifest()
  const actual = diffSources(baseline.sourceFiles, current.sourceFiles)
  const declared = await readDeclaredDelta(summaryPaths)
  assertSameList("added", actual.added, declared.added)
  assertSameList("deleted", actual.deleted, declared.deleted)
  assertSameList("modified", actual.modified, declared.modified)
  console.log(JSON.stringify({ sourceFidelity: "ok" }))
}

async function readDeclaredDelta(summaryPaths) {
  const added = []
  const deleted = []
  const modified = []
  for (const summaryPath of expandBraces(summaryPaths)) {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"))
    added.push(...summary.filesAdded.map((item) => item.path))
    deleted.push(...summary.filesDeleted.map((item) => item.path))
    modified.push(...summary.filesModified.map((item) => item.path))
  }
  return {
    added: uniqueSorted(added),
    deleted: uniqueSorted(deleted),
    modified: uniqueSorted(modified),
  }
}

function expandBraces(paths) {
  return paths.flatMap((item) => {
    const match = item.match(/\{([0-9]+)\.\.([0-9]+)\}/)
    if (!match) return [item]
    const start = Number(match[1])
    const end = Number(match[2])
    const result = []
    for (let index = start; index <= end; index += 1) {
      result.push(item.replace(match[0], String(index)))
    }
    return result
  })
}

function assertSameList(label, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(
      `${label} source delta mismatch: ${JSON.stringify({ actual: left, declared: right })}`,
    )
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort()
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
