import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"

import {
  materializeTask3FocusedContract,
  materializeTask3SplitInclusion,
  validateTask3SplitInclusion,
} from "./task3-numeric-evidence.mjs"

const currentTap = [
  "ℹ tests 21",
  "ℹ suites 0",
  "ℹ pass 21",
  "ℹ fail 0",
  "ℹ cancelled 0",
  "ℹ skipped 0",
  "ℹ todo 0",
].join("\n")

test("Given focused TAP, when materialized, then the exact 21/21 contract is derived", () => {
  const result = materializeTask3FocusedContract(currentTap)

  assert.deepEqual(result, {
    failedCount: 0,
    passedCount: 21,
    skippedCount: 0,
    suiteCount: 21,
  })
})

test("Given stale or malformed TAP, when materialized, then numeric evidence is rejected", () => {
  const stale = currentTap.replaceAll("21", String(Number("21") - 1))
  const malformed = currentTap.replace("ℹ pass 21\n", "")

  assert.throws(() => materializeTask3FocusedContract(stale), /does not match current contract/)
  assert.throws(() => materializeTask3FocusedContract(malformed), /must contain one/)
})

test("Given current split files, when LOC is materialized, then computed values are emitted and stale values fail", async () => {
  const artifact = await materializeTask3SplitInclusion(process.cwd())
  const stale = structuredClone(artifact)
  stale.loc.finalizer -= 1

  assert.equal(
    artifact.loc.finalizer,
    independentlyCountPureLoc("tests/high-priority-missing-services/finalize-task3.mjs"),
  )
  assert.ok(Object.values(artifact.loc).every((count) => count <= artifact.limit))
  await assert.rejects(
    validateTask3SplitInclusion(stale, process.cwd()),
    /does not match current source/,
  )
})

function independentlyCountPureLoc(relativePath) {
  const result = spawnSync(
    "awk",
    [
      "!/^[[:space:]]*$/ && !/^[[:space:]]*(#|\\/\\/)/ { count += 1 } END { print count }",
      path.join(process.cwd(), relativePath),
    ],
    { encoding: "utf8" },
  )
  assert.equal(result.status, 0, result.stderr)
  return Number(result.stdout.trim())
}
