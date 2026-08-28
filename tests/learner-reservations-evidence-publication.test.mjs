import assert from "node:assert/strict"
import { rm } from "node:fs/promises"
import test from "node:test"

import {
  assertCanonicalTopology,
  assertSecureModes,
  assertSnapshotCoherent,
  createFixture,
  installLegacyCanonical,
  publish,
  readCanonical,
  readViaCurrent,
  spawnInterruptionChild,
  stageGeneration,
} from "./learner-reservations-evidence-publication-helpers.mjs"

test("one current-pointer rename publishes a coherent bundle to concurrent readers", async () => {
  const fixture = await createFixture()
  try {
    // Given: canonical real files from a legacy run and a fully staged replacement.
    const legacy = await stageGeneration(fixture.root, "legacy", 1)
    await installLegacyCanonical(fixture, legacy)
    const next = await stageGeneration(fixture.root, "next", 2)

    // When: publication migrates the real paths and swaps the current pointer once.
    let preSwapSnapshot
    const seenRunIds = new Set()
    let reading = true
    let reader = null
    await publish(fixture, next, {
      beforePointerSwap: async () => {
        preSwapSnapshot = await readCanonical(fixture)
        assertSnapshotCoherent(preSwapSnapshot)
        reader = (async () => {
          while (reading) {
            const snapshot = await readViaCurrent(fixture)
            seenRunIds.add(snapshot.runId)
            assertSnapshotCoherent(snapshot)
            await new Promise((resolve) => setImmediate(resolve))
          }
        })()
        await new Promise((resolve) => setImmediate(resolve))
      },
    })
    reading = false
    assert.ok(reader, "publisher must expose the pre-swap boundary")
    await reader

    // Then: the pre-swap reader saw legacy, all snapshots were coherent, and canonical paths
    // resolve through the one current pointer to the new run.
    assert.equal(preSwapSnapshot.runId, "legacy-run")
    assert.deepEqual([...seenRunIds].sort(), ["legacy-run", "next-run"])
    const after = await readCanonical(fixture)
    assert.equal(after.runId, "next-run")
    assertSnapshotCoherent(after)
    await assertCanonicalTopology(fixture, "next-run")
    await assertSecureModes(fixture)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})

for (const phase of ["pre-swap", "post-swap"]) {
  test(`SIGKILL at ${phase} never exposes mixed canonical evidence`, async () => {
    const fixture = await createFixture()
    try {
      // Given: an already published baseline and a staged second generation.
      const baseline = await stageGeneration(fixture.root, "baseline", 3)
      await publish(fixture, baseline)
      const replacement = await stageGeneration(fixture.root, "replacement", 4)
      const before = await readCanonical(fixture)

      // When: a child publisher kills itself at the deterministic publication boundary.
      const result = await spawnInterruptionChild(fixture, replacement, phase)

      // Then: SIGKILL is observed and all seven canonical paths remain one generation.
      assert.equal(result.signal, "SIGKILL")
      assert.equal(result.code, null)
      const after = await readCanonical(fixture)
      assertSnapshotCoherent(after)
      assert.equal(after.runId, phase === "pre-swap" ? before.runId : replacement.runId)
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
    }
  })
}

test("a first-publication pre-swap SIGKILL is recovered by the next run", async () => {
  const fixture = await createFixture()
  try {
    // Given: an empty canonical root and a first fully staged generation.
    const interrupted = await stageGeneration(fixture.root, "interrupted-first", 7)

    // When: the first publisher is killed after bundle validation but before current exists.
    const result = await spawnInterruptionChild(fixture, interrupted, "pre-swap")
    assert.equal(result.signal, "SIGKILL")
    const recovery = await stageGeneration(fixture.root, "recovery-next", 8)
    await publish(fixture, recovery)

    // Then: the next run recognizes the prepared links and publishes one coherent generation.
    const after = await readCanonical(fixture)
    assert.equal(after.runId, recovery.runId)
    assertSnapshotCoherent(after)
    await assertCanonicalTopology(fixture, recovery.runId)
  } finally {
    await rm(fixture.root, { force: true, recursive: true })
  }
})
