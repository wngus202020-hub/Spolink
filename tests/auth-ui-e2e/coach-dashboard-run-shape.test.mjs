import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import {
  resolveCoachDashboardRunShape,
  resolveCoachDashboardRunTarget,
} from "./coach-dashboard-run-target.mjs"
import { executeCoachDashboardRun } from "./coach-dashboard-runner-core.mjs"

const epoch = "2026-08-29T03:00:00.000Z"
const cleanFixture = {
  coachProfilesRemaining: 0,
  graphRowsRemaining: 0,
  profilesRemaining: 0,
  usersRemaining: 0,
}

test("run target defines fixture and screenshot expectations for every supported shape", () => {
  assert.deepEqual(resolveShape(null), {
    expectedFixtureRuns: 3,
    expectedScreenshots: 7,
    projects: ["desktop-chromium"],
  })
  assert.deepEqual(resolveShape("visual|responsive"), {
    expectedFixtureRuns: 3,
    expectedScreenshots: 14,
    projects: ["desktop-chromium", "mobile-chromium", "tablet-chromium"],
  })
  for (const grep of ["populated|navigation", "redirect|ownership"]) {
    assert.deepEqual(resolveShape(grep), {
      expectedFixtureRuns: 1,
      expectedScreenshots: 1,
      projects: ["desktop-chromium"],
    })
  }
})

test("default full approves exactly three valid fixture events and seven screenshots", async () => {
  let expectedScreenshots = null
  const result = await runDefault(fixtureOutput(3), (count) => {
    expectedScreenshots = count
  })

  assert.equal(expectedScreenshots, 7)
  assert.equal(result.fixtureRuns, 3)
  assert.equal(result.visuals.files.length, 7)
  assert.equal(result.verdict, "APPROVE")
})

test("default full rejects missing invalid and extra fixture event counts", async () => {
  const cases = [fixtureOutput(0), fixtureOutput(2), fixtureOutput(4), fixtureOutput(3, 1)]
  for (const stdout of cases) {
    const result = await runDefault(stdout, () => {})
    assert.equal(result.verdict, "REJECT")
    assert.notEqual(result.fixtureRuns, 3)
  }
})

function resolveShape(grep) {
  return resolveCoachDashboardRunShape(resolveCoachDashboardRunTarget(grep))
}

function fixtureOutput(count, invalidIndex = -1) {
  return Array.from(
    { length: count },
    (_, index) =>
      `COACH_DASHBOARD_FIXTURE ${JSON.stringify({
        cleanup: index === invalidIndex ? { ...cleanFixture, usersRemaining: "0" } : cleanFixture,
        scenario: `full-${index}`,
      })}`,
  ).join("\n")
}

async function runDefault(stdout, observeScreenshotCount) {
  return executeCoachDashboardRun({
    epoch,
    outputPath: path.join("test-output", "default-summary.json"),
    visualDir: path.join("test-output", "default-visual"),
    dependencies: {
      collectBasicVisuals: async (_directory, expectedCount) => {
        observeScreenshotCount(expectedCount)
        return {
          files: Array.from({ length: expectedCount }, (_, index) => ({
            bytes: 1,
            name: `capture-${index}.png`,
            sha256: "a".repeat(64),
          })),
          verdict: "APPROVE",
        }
      },
      prepareRawOutput: async () => ({ cleanup: async () => {}, dir: "/private/raw" }),
      runPlaywright: async () => ({ exitCode: 0, signal: null, stderr: "", stdout }),
      withLifecycle: async (_options, callback) =>
        callback({
          baseUrl: "http://127.0.0.1:3999",
          status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
        }),
    },
  })
}
