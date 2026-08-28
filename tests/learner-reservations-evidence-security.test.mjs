import assert from "node:assert/strict"
import { chmod, cp, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createFixture,
  fixturePaths,
  publish,
  readCanonical,
  screenshotNames,
  spawnInterruptionChild,
  stageGeneration,
} from "./learner-reservations-evidence-publication-helpers.mjs"

test("publisher rejects pointer escape, canonical-link tampering, and mode drift", async () => {
  const cases = ["pointer", "canonical", "mode"]
  for (const attack of cases) {
    const fixture = await createFixture()
    let outside = null
    try {
      // Given: one valid publication and one staged replacement.
      const baseline = await stageGeneration(fixture.root, "baseline", 5)
      await publish(fixture, baseline)
      const replacement = await stageGeneration(fixture.root, "replacement", 6)
      const before = await readCanonical(fixture)

      if (attack === "pointer") {
        outside = await mkdtemp(path.join(os.tmpdir(), "spolink-pointer-escape-"))
        await rm(fixture.current)
        await symlink(outside, fixture.current)
      } else if (attack === "canonical") {
        const target = path.join(fixture.visualDir, screenshotNames[0])
        await rm(target)
        await symlink("../../../outside.png", target)
      } else {
        await chmod(fixture.versionsRoot, 0o755)
      }

      // When/Then: publication rejects the changed trust boundary before a pointer swap.
      await assert.rejects(
        () => publish(fixture, replacement),
        /owned|pointer|canonical|mode|target/iu,
      )
      if (attack === "mode") {
        await chmod(fixture.versionsRoot, 0o700)
        assert.deepEqual(await readCanonical(fixture), before)
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true })
      if (outside) await rm(outside, { force: true, recursive: true })
    }
  }
})

if (process.env["SPOLINK_CANONICAL_EVIDENCE_ROOT"]) {
  test("pre-swap SIGKILL preserves the supplied canonical seven-path publication", async () => {
    const fixture = fixturePaths(path.resolve(process.env["SPOLINK_CANONICAL_EVIDENCE_ROOT"]))
    const stageRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-canonical-interruption-"))
    try {
      // Given: a staged copy of the currently published canonical bundle with a distinct runId.
      const currentBundle = await realpath(fixture.current)
      const screenshotsDir = path.join(stageRoot, "screenshots")
      const summaryPath = path.join(stageRoot, "focused-summary.json")
      await cp(path.join(currentBundle, "screenshots"), screenshotsDir, { recursive: true })
      const summary = JSON.parse(
        await readFile(path.join(currentBundle, "focused-summary.json"), "utf8"),
      )
      const runId = `forced-pre-swap-${Date.now().toString(36)}`
      await writeFile(summaryPath, `${JSON.stringify({ ...summary, runId }, null, 2)}\n`, {
        mode: 0o600,
      })
      await chmod(screenshotsDir, 0o700)
      for (const name of screenshotNames) {
        await chmod(path.join(screenshotsDir, name), 0o600)
      }
      const staged = { runId, screenshotsDir, summaryPath }
      const before = await readCanonical(fixture)

      // When: the real-root publisher is killed immediately before its sole pointer rename.
      const result = await spawnInterruptionChild(fixture, staged, "pre-swap")

      // Then: the child died by SIGKILL and all seven stable canonical paths are byte-identical.
      assert.equal(result.signal, "SIGKILL")
      assert.deepEqual(await readCanonical(fixture), before)
    } finally {
      await rm(stageRoot, { force: true, recursive: true })
    }
  })
}
