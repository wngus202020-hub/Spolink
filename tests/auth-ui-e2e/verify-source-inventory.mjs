#!/usr/bin/env node
import { createHash } from "node:crypto"
import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import {
  assertRedactedMobileAuthReceipt,
  sourceInventoryAllowedModifiedPaths,
  sourceInventoryAllowedPaths,
  sourceInventoryBaselinePath,
} from "./mobile-auth-signup-cleanup-race-contract.mjs"
import { writeJsonMode600 } from "./process.mjs"
import { safeRunnerFailure } from "./runner-failure.mjs"

export const sourceInventoryIncludedRootPrefixes = Object.freeze([
  "app/",
  "components/",
  "lib/",
  "public/",
  "scripts/",
  "supabase/",
  "tests/",
])

export const sourceInventoryIncludedRootFiles = Object.freeze([
  ".env.example",
  ".gitignore",
  "AGENTS.md",
  "DESIGN.md",
  "biome.json",
  "env.d.ts",
  "next.config.ts",
  "package.json",
  "playwright.auth.config.ts",
  "pnpm-lock.yaml",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
])

export const sourceInventoryExcludedPrefixes = Object.freeze([
  ".codegraph/",
  ".git/",
  ".next/",
  ".omo/drafts/",
  ".omo/evidence/",
  ".omo/notepads/",
  ".omo/plans/",
  ".omo/quarantine/",
  ".omo/run-continuation/",
  ".omo/start-work/",
  ".playwright-mcp/",
  ".supabase/",
  ".turbo/",
  ".vercel/",
  "coverage/",
  "node_modules/",
  "playwright-report/",
  "supabase/.branches/",
  "supabase/.temp/",
  "test-results/",
])

export const sourceInventoryExcludedExactPaths = Object.freeze([
  ".DS_Store",
  ".env",
  ".env.local",
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
])

const redactedBaselinePathAliases = Object.freeze(
  new Map([
    ["app/auth/reset-redacted/page.tsx", "app/auth/reset-password/page.tsx"],
    ["app/auth/update-redacted/page.tsx", "app/auth/update-password/page.tsx"],
    ["app/auth/update-redacted/submit/route.ts", "app/auth/update-password/submit/route.ts"],
    ["components/auth/reset-redacted-form.tsx", "components/auth/reset-password-form.tsx"],
    ["components/auth/update-redacted-form.tsx", "components/auth/update-password-form.tsx"],
    ["lib/auth/flow-redacted.ts", "lib/auth/flow-token.ts"],
    ["lib/auth/redacteds.ts", "lib/auth/cookies.ts"],
    ["lib/auth/update-redacted-page.ts", "lib/auth/update-password-page.ts"],
    ["lib/auth/update-redacted-route.ts", "lib/auth/update-password-route.ts"],
    [
      "tests/auth-ui-e2e/auth-update-redacted.spec.ts",
      "tests/auth-ui-e2e/auth-update-password.spec.ts",
    ],
    [
      "tests/auth-ui-e2e/run-auth-update-redacted.mjs",
      "tests/auth-ui-e2e/run-auth-update-password.mjs",
    ],
    [
      "tests/auth-ui-e2e/session-redacted-redacted.test-cases.mjs",
      "tests/auth-ui-e2e/session-token-cookie.test-cases.mjs",
    ],
    ["tests/supabase-e2e/ssr-redacted-jar.mjs", "tests/supabase-e2e/ssr-cookie-jar.mjs"],
    ["tests/supabase-e2e/task8/qa-redacteds.mjs", "tests/supabase-e2e/task8/qa-cookies.mjs"],
  ]),
)

async function main() {
  const [outputArg, baselineArg = sourceInventoryBaselinePath] = process.argv.slice(2)
  if (!outputArg) {
    throw new Error("usage: node tests/auth-ui-e2e/verify-source-inventory.mjs <output> [baseline]")
  }
  const outputPath = await resolveFreshOutputPath(outputArg)
  const baseline = await readInventory(baselineArg)
  const currentEntries = await collectSourceInventoryEntries()
  const comparison = compareBaselineEntries(baseline.entries, currentEntries)
  const verdict = inventoryComparisonApproved(comparison) ? "APPROVE" : "REJECT"
  const receipt = {
    schemaVersion: 1,
    baseline: {
      aggregateSha256: baseline.aggregateSha256,
      capturedBeforeBehaviorChanges: baseline.capturedBeforeBehaviorChanges === true,
      entryCount: baseline.entries.length,
      path: baselineArg,
      runId: baseline.runId,
    },
    allowedModifiedPaths: effectiveSourceInventoryReceiptPaths(sourceInventoryAllowedModifiedPaths),
    allowedPaths: effectiveSourceInventoryReceiptPaths(sourceInventoryAllowedPaths),
    comparison: redactComparisonPaths(comparison),
    current: {
      aggregateSha256: aggregateEntries(currentEntries),
      entryCount: currentEntries.length,
    },
    inventoryScope: {
      excludedExactPaths: sourceInventoryExcludedExactPaths,
      excludedPrefixes: sourceInventoryExcludedPrefixes,
      includedRootFiles: sourceInventoryIncludedRootFiles,
      includedRootPrefixes: sourceInventoryIncludedRootPrefixes,
    },
    verdict,
  }
  assertRedactedMobileAuthReceipt(receipt)
  await writeJsonMode600(outputPath, receipt)
  console.log(JSON.stringify({ outputPath, sourceInventory: verdict }))
  if (verdict !== "APPROVE") process.exitCode = 1
}

async function resolveFreshOutputPath(outputArg) {
  const outputPath = await resolveEvidenceChildPath(outputArg, {
    createParent: true,
    kind: "file",
    suffix: ".json",
  })
  try {
    await lstat(outputPath)
    throw new Error("Source inventory output path must be fresh")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return outputPath
    throw error
  }
}

async function readInventory(filePath) {
  const inventory = JSON.parse(await readFile(filePath, "utf8"))
  if (inventory?.schemaVersion !== 1 || !Array.isArray(inventory.entries)) {
    throw new Error("Todo 1 source inventory has an unsupported shape")
  }
  const seen = new Set()
  const entries = []
  for (const entry of inventory.entries) {
    const inventoryPath = canonicalizeRedactedBaselinePath(entry?.path)
    if (
      typeof inventoryPath !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
      seen.has(inventoryPath)
    ) {
      throw new Error("Todo 1 source inventory has unsupported entries")
    }
    seen.add(inventoryPath)
    entries.push({ path: inventoryPath, sha256: entry.sha256 })
  }
  return { ...inventory, entries }
}

export function canonicalizeRedactedBaselinePath(relativePath) {
  return redactedBaselinePathAliases.get(relativePath) ?? relativePath
}

export async function collectSourceInventoryEntries(repoRoot = process.cwd()) {
  const entries = []
  await collectEntriesFromDirectory(repoRoot, "", entries)
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function collectEntriesFromDirectory(repoRoot, relativeDir, entries) {
  const directoryPath = path.join(repoRoot, relativeDir)
  for (const dirent of await readdir(directoryPath, { withFileTypes: true })) {
    const relativePath = normalizeInventoryPath(path.join(relativeDir, dirent.name))
    if (sourceInventoryPathExcluded(relativePath)) continue
    if (dirent.isDirectory()) {
      if (!sourceInventoryDirectoryIncluded(relativePath)) continue
      await collectEntriesFromDirectory(repoRoot, relativePath, entries)
      continue
    }
    if (!sourceInventoryPathIncluded(relativePath)) continue
    if (!dirent.isFile()) {
      throw new Error(`Unsupported source inventory entry type: ${relativePath}`)
    }
    entries.push({
      path: relativePath,
      sha256: await fileSha256(path.join(repoRoot, relativePath)),
    })
  }
}

export function sourceInventoryPathIncluded(relativePath) {
  return (
    sourceInventoryIncludedRootFiles.includes(relativePath) ||
    sourceInventoryIncludedRootPrefixes.some((prefix) => relativePath.startsWith(prefix))
  )
}

export function sourceInventoryDirectoryIncluded(relativePath) {
  const directoryPrefix = `${relativePath}/`
  return sourceInventoryIncludedRootPrefixes.some(
    (prefix) => prefix.startsWith(directoryPrefix) || directoryPrefix.startsWith(prefix),
  )
}

export function sourceInventoryPathExcluded(relativePath) {
  return (
    sourceInventoryExcludedExactPaths.includes(relativePath) ||
    sourceInventoryExcludedPrefixes.some((prefix) => relativePath.startsWith(prefix)) ||
    /^\.env\.(?!example$)/u.test(relativePath)
  )
}

export function compareBaselineEntries(baselineEntries, currentEntries) {
  const allowedModifiedPaths = new Set(sourceInventoryAllowedModifiedPaths)
  const baselineByPath = new Map(baselineEntries.map((entry) => [entry.path, entry.sha256]))
  const currentByPath = new Map(currentEntries.map((entry) => [entry.path, entry.sha256]))
  const allowedModified = []
  const deleted = []
  const unchanged = []
  const unexpectedAdded = []
  const unexpectedModified = []
  for (const [currentPath, currentSha256] of currentByPath) {
    const baselineSha256 = baselineByPath.get(currentPath)
    if (typeof baselineSha256 !== "string") {
      unexpectedAdded.push(currentPath)
    } else if (currentSha256 === baselineSha256) {
      unchanged.push(currentPath)
    } else if (allowedModifiedPaths.has(currentPath)) {
      allowedModified.push(currentPath)
    } else {
      unexpectedModified.push(currentPath)
    }
  }
  for (const baselinePath of baselineByPath.keys()) {
    if (!currentByPath.has(baselinePath)) deleted.push(baselinePath)
  }
  return {
    allowedModified: allowedModified.sort(),
    deleted: deleted.sort(),
    modified: allowedModified.sort(),
    unchanged: unchanged.sort(),
    unexpectedAdded: unexpectedAdded.sort(),
    unexpectedModified: unexpectedModified.sort(),
  }
}

async function fileSha256(filePath) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
}

export function aggregateEntries(entries) {
  const hash = createHash("sha256")
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(entry.path)
    hash.update("\0")
    hash.update(entry.sha256)
    hash.update("\n")
  }
  return hash.digest("hex")
}

export function inventoryComparisonApproved(comparison) {
  return (
    comparison.deleted.length === 0 &&
    comparison.unexpectedAdded.length === 0 &&
    comparison.unexpectedModified.length === 0
  )
}

function effectiveSourceInventoryReceiptPaths(paths) {
  return paths.filter(
    (relativePath) =>
      sourceInventoryPathIncluded(relativePath) && !sourceInventoryPathExcluded(relativePath),
  )
}

function redactComparisonPaths(comparison) {
  return Object.fromEntries(
    Object.entries(comparison).map(([key, paths]) => [key, paths.map(redactInventoryPath)]),
  )
}

function redactInventoryPath(filePath) {
  return filePath.replace(/email|password|phone|cookie|token|postgres|sb_/giu, "redacted")
}

function normalizeInventoryPath(filePath) {
  return filePath.split(path.sep).join("/")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    console.error(JSON.stringify(safeRunnerFailure(error)))
    process.exitCode = 1
  }
}
