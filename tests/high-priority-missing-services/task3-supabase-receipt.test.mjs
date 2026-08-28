import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmod, link, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { computeTask3SourceBinding } from "./task3-evidence.mjs"
import { runTask3SupabaseReceipt } from "./task3-supabase-receipt.mjs"
import {
  buildTask3AttemptManifest,
  verifyTask3AttemptEvidence,
} from "./verify-task3-attempt-evidence.mjs"

const repoRoot = process.cwd()
const remediationRoot = path.join(
  repoRoot,
  ".omo/evidence/high-priority-missing-services/task-3/remediation",
)
const ownedRoots = []

test.after(async () => {
  await Promise.all(ownedRoots.map((root) => rm(root, { force: true, recursive: true })))
})

test("sealed exact receipt replay preserves every byte and removes its private workspace", async () => {
  const root = await createAttempt("sealed")
  await runTask3SupabaseReceipt({ attempt: relative(root), repoRoot, runAggregate: fakeAggregate })
  await seal(root)
  const before = await snapshot(root)
  const replayBefore = await replayRoots()

  const result = await runTask3SupabaseReceipt({
    attempt: relative(root),
    repoRoot,
    runAggregate: fakeAggregate,
  })

  assert.equal(result.mode, "sealed-replay")
  assert.deepEqual(result.counts, expectedCounts())
  assert.deepEqual(await snapshot(root), before)
  assert.deepEqual(await replayRoots(), replayBefore)
  await verifyTask3AttemptEvidence({
    attemptRoot: root,
    manifest: JSON.parse(await readFile(path.join(root, "task-7-current-attempt-index.json"))),
  })
})

test("unsealed exact receipt generation writes only its confined aggregate contract", async () => {
  const root = await createAttempt("generation")
  const result = await runTask3SupabaseReceipt({
    attempt: relative(root),
    repoRoot,
    runAggregate: fakeAggregate,
  })
  assert.equal(result.mode, "generation")
  assert.deepEqual(result.counts, expectedCounts())
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, "task-3-supabase-replay-contract.json"))).counts,
    expectedCounts(),
  )
})

test("exact receipt rejects traversed, arbitrary, archived, stale, and unsafe attempt roots", async () => {
  const valid = await createAttempt("invalid")
  const archived = path.join(remediationRoot, "archive", path.basename(valid))
  const stale = await createAttempt("stale")
  const staleBindingPath = path.join(stale, "task-3-binding.json")
  const staleBinding = JSON.parse(await readFile(staleBindingPath))
  staleBinding.sourceManifestSha256 = "0".repeat(64)
  await privateJson(staleBindingPath, staleBinding)
  const unsafeMode = await createAttempt("mode")
  await chmod(unsafeMode, 0o755)
  const hardlinked = await createAttempt("hardlink")
  await link(
    path.join(hardlinked, "task-3-binding.json"),
    path.join(hardlinked, "binding-hardlink.json"),
  )
  const symlinked = await createAttempt("symlink")
  await symlink("task-3-binding.json", path.join(symlinked, "binding-alias.json"))
  const invalid = [
    "../attempt-escaped",
    "/tmp/attempt-arbitrary",
    relative(archived),
    relative(stale),
    relative(unsafeMode),
    relative(hardlinked),
    relative(symlinked),
  ]
  for (const attempt of invalid) {
    await assert.rejects(
      runTask3SupabaseReceipt({
        attempt,
        repoRoot,
        runAggregate: async () => assert.fail("invalid roots must fail before execution"),
      }),
    )
  }
})

test("failed sealed replay still removes its private workspace", async () => {
  const root = await createAttempt("failed-cleanup")
  await runTask3SupabaseReceipt({ attempt: relative(root), repoRoot, runAggregate: fakeAggregate })
  await seal(root)
  const replayBefore = await replayRoots()
  await assert.rejects(
    runTask3SupabaseReceipt({
      attempt: relative(root),
      repoRoot,
      runAggregate: async () => ({ exitCode: 9 }),
    }),
    /aggregate command failed/,
  )
  assert.deepEqual(await replayRoots(), replayBefore)
})

test("aggregate generation rejects a source binding changed during execution", async () => {
  const root = await createAttempt("binding-swap")
  await assert.rejects(
    runTask3SupabaseReceipt({
      attempt: relative(root),
      repoRoot,
      runAggregate: async (context) => {
        const result = await fakeAggregate(context)
        const bindingPath = path.join(root, "task-3-binding.json")
        const binding = JSON.parse(await readFile(bindingPath, "utf8"))
        binding.worktreeStatusSha256 = "0".repeat(64)
        await privateJson(bindingPath, binding)
        return result
      },
    }),
    /source binding changed/,
  )
})

async function createAttempt(label) {
  const root = path.join(remediationRoot, `attempt-task3-receipt-${label}-${process.pid}`)
  ownedRoots.push(root)
  await mkdir(root, { mode: 0o700 })
  const source = await computeTask3SourceBinding(repoRoot)
  await privateJson(path.join(root, "task-3-binding.json"), {
    attemptId: path.basename(root),
    capturedAt: new Date().toISOString(),
    head: source.head,
    recordType: "task-3-binding",
    schemaVersion: 1,
    sourceManifestSha256: source.manifestSha256,
    task: "task-3",
    worktreeStatusSha256: source.statusSha256,
  })
  return root
}

async function fakeAggregate({ attemptRoot, outputDir }) {
  await mkdir(outputDir, { mode: 0o700, recursive: true })
  await privateJson(path.join(attemptRoot, "focused-reservation-lifecycle.json"), {
    cleanup: ["observer-and-barrier-closed", "fixture-graph-removed"],
    observations: [{ status: "passed" }, { status: "passed" }],
    verdict: "focused-pass",
  })
  await privateJson(path.join(attemptRoot, "task-5-db-races.json"), {
    expectedRaceCount: 7,
    races: Array.from({ length: 7 }, (_, index) => ({ name: `race-${index}`, pendingWorkers: 0 })),
    verdict: "passed",
  })
  const cases = [
    ...Array.from({ length: 30 }, () => ({
      noStore: true,
      rollbackEquivalent: true,
      type: "rejected",
    })),
    ...Array.from({ length: 3 }, () => ({ noStore: true, type: "replay" })),
    ...Array.from({ length: 3 }, () => ({ noStore: true, type: "success" })),
  ]
  await privateJson(path.join(outputDir, "reservation-lifecycle-api.test.mjs.json"), {
    exitCode: 0,
    stdout: `TASK4_HTTP_SUMMARY ${JSON.stringify({ cases })}\n`,
  })
  await privateJson(path.join(outputDir, "integrated-summary-fixture.json"), { status: "success" })
  return { exitCode: 0 }
}

async function seal(root) {
  const manifest = await buildTask3AttemptManifest(root, repoRoot)
  await privateJson(path.join(root, "task-7-current-attempt-index.json"), manifest)
  await privateJson(path.join(root, "task-7-evidence-hygiene.json"), { verdict: "passed" })
}

async function privateJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}

async function snapshot(root) {
  const entries = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relativePath = path.relative(root, absolute)
      if (entry.isDirectory()) await walk(absolute)
      else
        entries.push([
          relativePath,
          createHash("sha256")
            .update(await readFile(absolute))
            .digest("hex"),
        ])
    }
  }
  await walk(root)
  return entries.sort(([left], [right]) => left.localeCompare(right))
}

async function replayRoots() {
  return (await readdir(remediationRoot)).filter((name) => name.startsWith("attempt-replay-"))
}

function relative(root) {
  return path.relative(repoRoot, root).split(path.sep).join("/")
}

function expectedCounts() {
  return {
    aggregateSuites: 9,
    httpCases: 36,
    httpRejected: 30,
    httpReplayed: 3,
    httpRollbackFailures: 0,
    httpSucceeded: 3,
    lifecycleObservations: 2,
    pendingRaceWorkers: 0,
    races: 7,
  }
}
