import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { resolveCoachDashboardRunTarget } from "./coach-dashboard-run-target.mjs"
import { executeCoachDashboardRun } from "./coach-dashboard-runner-core.mjs"
import { visualScreenshotNames } from "./coach-dashboard-visual-artifacts.mjs"

const cleanFixture = {
  coachProfilesRemaining: 0,
  graphRowsRemaining: 0,
  profilesRemaining: 0,
  usersRemaining: 0,
}

test("visual grep resolves the dedicated task8 evidence target", () => {
  assert.deepEqual(resolveCoachDashboardRunTarget("visual|responsive"), {
    outputPath: ".omo/evidence/coach-dashboard-screen/task-8/task-8-coach-dashboard-screen.json",
    root: ".omo/evidence/coach-dashboard-screen/task-8",
    variant: "visual-responsive",
    visualDir: ".omo/evidence/coach-dashboard-screen/task-8/screenshots",
  })
})

test("visual grep runs all three projects serially and requires fourteen fresh captures", async () => {
  let invocation = null
  let collectionOptions = null
  const result = await executeCoachDashboardRun({
    epoch: "2026-08-29T03:00:00.000Z",
    grep: "visual responsive",
    outputPath: path.join("test-output", "visual-summary.json"),
    visualDir: path.join("test-output", "visual"),
    dependencies: {
      collectVisuals: async (_directory, options) => {
        collectionOptions = options
        return {
          comparisons: [],
          files: visualScreenshotNames.map((name) => ({
            bytes: 1,
            name,
            sha256: "a".repeat(64),
          })),
          issues: [],
          verdict: "APPROVE",
        }
      },
      prepareRawOutput: async () => ({ cleanup: async () => {}, dir: "/private/raw" }),
      prepareVisualDir: async () => {},
      readSourceBinding: async () => ({
        aggregateSha256: "b".repeat(64),
        files: [],
        latestMtimeMs: 123,
      }),
      runPlaywright: async (value) => {
        invocation = value
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout: visualReporterOutput(),
        }
      },
      withLifecycle: async (_options, callback) =>
        callback({
          baseUrl: "http://127.0.0.1:3999",
          status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
        }),
    },
  })

  assert.ok(invocation)
  assert.deepEqual(
    invocation.args.filter((argument) => argument.startsWith("--project=")),
    ["--project=desktop-chromium", "--project=mobile-chromium", "--project=tablet-chromium"],
  )
  assert.match(invocation.args.join(" "), /--workers 1/u)
  assert.equal(collectionOptions.expectedNames.length, 14)
  assert.equal(collectionOptions.freshnessFloorMs, 123)
  assert.equal(result.fixtureRuns, 3)
  assert.equal(result.visualChecks.captureCount, 14)
  assert.equal(result.verdict, "APPROVE")
})

function visualReporterOutput() {
  const projects = [
    ["desktop", 5],
    ["mobile", 5],
    ["tablet", 4],
  ]
  return projects
    .flatMap(([project, count]) => [
      `COACH_DASHBOARD_FIXTURE ${JSON.stringify({
        cleanup: cleanFixture,
        scenario: "visual-responsive:complete",
      })}`,
      `COACH_DASHBOARD_VISUAL ${JSON.stringify({
        captures: Array.from({ length: count }, (_, index) => ({ index })),
        project,
        verdict: "APPROVE",
      })}`,
    ])
    .join("\n")
}
