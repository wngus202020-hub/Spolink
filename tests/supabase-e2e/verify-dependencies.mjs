#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { diffSources, readCurrentManifest } from "./task8/source-manifest.mjs"

const allowedDevAdds = new Map([
  ["@iarna/toml", "2.2.5"],
  ["postgres", "3.4.9"],
  ["supabase", "2.109.1"],
])

async function main() {
  const baseline = JSON.parse(
    await readFile(".omo/evidence/dependency-baseline-supabase-auth-rls-e2e.json", "utf8"),
  )
  const ledger = await readLedger()
  assert.equal(baseline.schemaVersion, 1)
  assert.equal(
    ledger.filter((entry) => entry.todo === 8).length,
    1,
    "expected exactly one Todo8 ledger record",
  )
  assertDependencyDelta(baseline, await readCurrentManifest())
  assertDeclaredSources(baseline, await readCurrentManifest(), ledger)
  await assertLockEntries()
  console.log(JSON.stringify({ dependencyVerification: "ok", todoLedgerEntries: ledger.length }))
}

async function readLedger() {
  const text = await readFile(".omo/evidence/change-ledger-supabase-auth-rls-e2e.jsonl", "utf8")
  return text
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function assertDependencyDelta(baseline, current) {
  const baseProd = new Map(baseline.productionDependencies.map((item) => [item.name, item.version]))
  const baseDev = new Map(baseline.developmentDependencies.map((item) => [item.name, item.version]))
  const prod = new Map(current.productionDependencies.map((item) => [item.name, item.version]))
  const dev = new Map(current.developmentDependencies.map((item) => [item.name, item.version]))
  assert.deepEqual(delta(baseProd, prod), { added: [], changed: [], removed: [] })
  assert.deepEqual(delta(baseDev, dev), {
    added: [...allowedDevAdds].map(([name, to]) => ({ name, to })).sort(sortName),
    changed: [],
    removed: [],
  })
}

function assertDeclaredSources(baseline, current, ledger) {
  const diff = diffSources(baseline.sourceFiles, current.sourceFiles)
  const declared = new Set()
  for (const entry of ledger) {
    for (const key of ["filesAdded", "filesModified", "filesDeleted"]) {
      for (const filePath of entry[key] ?? []) declared.add(filePath)
    }
  }
  for (const filePath of [...diff.added, ...diff.modified, ...diff.deleted]) {
    assert.equal(declared.has(filePath), true, `changed source is not declared: ${filePath}`)
  }
}

async function assertLockEntries() {
  const lock = await readFile(path.join(process.cwd(), "pnpm-lock.yaml"), "utf8")
  for (const [name, version] of allowedDevAdds) {
    assert.match(
      lock,
      new RegExp(
        `['"]?${escapeRegExp(name)}['"]?:\\n\\s+specifier: ${escapeRegExp(version)}\\n\\s+version: ${escapeRegExp(version)}`,
      ),
    )
    assert.match(lock, new RegExp(`['"]?${escapeRegExp(name)}@${escapeRegExp(version)}['"]?:`))
  }
}

function delta(before, after) {
  return {
    added: [...after]
      .filter(([name]) => !before.has(name))
      .map(([name, to]) => ({ name, to }))
      .sort(sortName),
    changed: [...after]
      .filter(([name, to]) => before.has(name) && before.get(name) !== to)
      .map(([name, to]) => ({ from: before.get(name), name, to }))
      .sort(sortName),
    removed: [...before]
      .filter(([name]) => !after.has(name))
      .map(([name, from]) => ({ from, name }))
      .sort(sortName),
  }
}

function sortName(left, right) {
  return left.name.localeCompare(right.name)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
