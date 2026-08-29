import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  readCoachDashboardTask8Report,
  writeCoachDashboardTask8Reports,
} from "./coach-dashboard-task8-reports.mjs"

test("task8 report writer publishes bounded hash-backed capture and geometry reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "coach-dashboard-task8-"))
  try {
    const files = Array.from({ length: 14 }, (_, index) => ({
      fresh: true,
      name: `capture-${index}.png`,
      sha256: "a".repeat(64),
    }))
    await writeCoachDashboardTask8Reports({
      root,
      summary: {
        fixtureCleanup: {
          coachProfilesRemaining: 0,
          graphRowsRemaining: 0,
          profilesRemaining: 0,
          usersRemaining: 0,
        },
        sourceBinding: { aggregateSha256: "b".repeat(64), files: [] },
        verdict: "APPROVE",
        visualChecks: { captureCount: 14, projects: [], verdict: "APPROVE" },
        visuals: { comparisons: [], files, verdict: "APPROVE" },
      },
    })

    const capture = await readCoachDashboardTask8Report(path.join(root, "capture-manifest.json"))
    const geometry = await readCoachDashboardTask8Report(path.join(root, "geometry-report.json"))
    assert.equal(capture.captureCount, 14)
    assert.equal(geometry.captureCount, 14)
    assert.equal(capture.selfHash.value.length, 64)
    assert.equal(JSON.stringify(capture).includes("@"), false)

    await assert.rejects(
      writeCoachDashboardTask8Reports({ root, summary: { verdict: "REJECT" } }),
      /complete approved fourteen-capture run/u,
    )
    await readFile(path.join(root, "capture-manifest.json"), "utf8")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
