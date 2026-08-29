import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { assertCoachDashboardEvidenceRedacted } from "./coach-dashboard-evidence.mjs"
import { shouldInjectCoachDashboardFailure } from "./coach-dashboard-injection.ts"
import { executeCoachDashboardRun } from "./coach-dashboard-runner-core.mjs"

const epoch = "2026-08-29T03:00:00.000Z"
const fakeOutputRoot = path.join("test-output", "coach-dashboard")
const cleanFixture = {
  coachProfilesRemaining: 0,
  graphRowsRemaining: 0,
  profilesRemaining: 0,
  usersRemaining: 0,
}

test("runner reuses one lifecycle, one worker, supplied epoch, and grep passthrough", async () => {
  const observed = { lifecycleCalls: 0, lifecycleCleaned: false, playwright: null }
  const result = await executeCoachDashboardRun({
    epoch,
    grep: "smoke foundation",
    outputPath: path.join(fakeOutputRoot, "fake-summary.json"),
    visualDir: path.join(fakeOutputRoot, "fake-visual"),
    dependencies: {
      ...successfulDependencies((invocation) => {
        observed.playwright = invocation
      }),
      withLifecycle: async (options, callback) => {
        observed.lifecycleCalls += 1
        assert.equal(options.enableConfirmations, false)
        assert.equal(options.enableCoachUiFixtures, true)
        try {
          return await callback(lifecycleContext())
        } finally {
          observed.lifecycleCleaned = true
        }
      },
    },
  })

  assert.equal(observed.lifecycleCalls, 1)
  assert.equal(observed.lifecycleCleaned, true)
  assert.ok(observed.playwright)
  assert.match(observed.playwright.args.join(" "), /--workers 1/u)
  assert.match(observed.playwright.args.join(" "), /--grep smoke foundation/u)
  assert.equal(observed.playwright.env.SPOLINK_COACH_DASHBOARD_EPOCH, epoch)
  assert.equal("SPOLINK_COACH_DASHBOARD_INJECT_FAILURE" in observed.playwright.env, false)
  assert.equal("SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT" in observed.playwright.env, false)
  assert.equal(result.verdict, "APPROVE")
  assert.deepEqual(result.fixtureCleanup, cleanFixture)
  assertCoachDashboardEvidenceRedacted(result)
})

test("injected failure remains nonzero and preserves all four cleanup counters", async () => {
  const cleanup = []
  let playwrightEnv = null
  const result = await executeCoachDashboardRun({
    allowInjectedFailure: true,
    epoch,
    failurePoint: "after-seed",
    outputPath: path.join(fakeOutputRoot, "failure-summary.json"),
    visualDir: path.join(fakeOutputRoot, "failure-visual"),
    dependencies: {
      collectVisuals: async () => ({ files: [], verdict: "REJECT" }),
      prepareRawOutput: async () => ({
        cleanup: async () => cleanup.push("raw"),
        dir: "/private/raw",
      }),
      runPlaywright: async (invocation) => {
        playwrightEnv = invocation.env
        return {
          exitCode: 1,
          signal: null,
          stderr: "Error stack /Users/private trace.zip",
          stdout: fixtureEvent("injected-failure"),
        }
      },
      withLifecycle: async (_options, callback) => {
        try {
          return await callback(lifecycleContext())
        } finally {
          cleanup.push("lifecycle")
        }
      },
    },
  })

  assert.equal(result.exitCode, 1)
  assert.equal(result.verdict, "REJECT")
  assert.deepEqual(result.fixtureCleanup, cleanFixture)
  assert.deepEqual(cleanup.sort(), ["lifecycle", "raw"])
  assert.equal(playwrightEnv.SPOLINK_COACH_DASHBOARD_INJECT_FAILURE, "after-seed")
  assert.equal(playwrightEnv.SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT, "1")
  assert.match(result.failureHash, /^[0-9a-f]{64}$/u)
  assert.equal("failureDetails" in result, false)
  assert.doesNotMatch(JSON.stringify(result), /Error stack|trace\.zip|\/Users\//u)
})

test("ordinary runner strips stale inherited contract and injection environment", async () => {
  const previousContract = process.env["SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT"]
  const previousInjection = process.env["SPOLINK_COACH_DASHBOARD_INJECT_FAILURE"]
  process.env["SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT"] = "1"
  process.env["SPOLINK_COACH_DASHBOARD_INJECT_FAILURE"] = "after-seed"
  let childEnv = null
  try {
    await executeCoachDashboardRun({
      epoch,
      outputPath: path.join(fakeOutputRoot, "ordinary-summary.json"),
      visualDir: path.join(fakeOutputRoot, "ordinary-visual"),
      dependencies: successfulDependencies((invocation) => {
        childEnv = invocation.env
      }),
    })
  } finally {
    restoreEnvironment("SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT", previousContract)
    restoreEnvironment("SPOLINK_COACH_DASHBOARD_INJECT_FAILURE", previousInjection)
  }

  assert.ok(childEnv)
  assert.equal("SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT" in childEnv, false)
  assert.equal("SPOLINK_COACH_DASHBOARD_INJECT_FAILURE" in childEnv, false)
})

test("direct spec injection requires both selector and contract gate", () => {
  assert.equal(
    shouldInjectCoachDashboardFailure({ SPOLINK_COACH_DASHBOARD_INJECT_FAILURE: "after-seed" }),
    false,
  )
  assert.equal(
    shouldInjectCoachDashboardFailure({ SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT: "1" }),
    false,
  )
  assert.equal(
    shouldInjectCoachDashboardFailure({
      SPOLINK_COACH_DASHBOARD_INJECT_FAILURE: "after-seed",
      SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT: "1",
    }),
    true,
  )
})

test("package exposes only the focused runner and auth aggregate remains unchanged", async () => {
  const [packageJson, aggregate] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("tests/auth-ui-e2e/run.mjs", "utf8"),
  ])

  assert.equal(
    packageJson.scripts["test:e2e:coach-dashboard"],
    "node tests/auth-ui-e2e/run-coach-dashboard.mjs",
  )
  assert.equal(packageJson.scripts["test:e2e:auth"].includes("coach-dashboard"), false)
  assert.equal(aggregate.includes("coach-dashboard"), false)
})

test("focused contract inventory stays split and independent of evidence files", async () => {
  const directory = "tests/auth-ui-e2e"
  const names = (await readdir(directory))
    .filter((name) => /^coach-dashboard-.*\.test\.mjs$/u.test(name))
    .sort()

  assert.deepEqual(names, [
    "coach-dashboard-evidence-security.test.mjs",
    "coach-dashboard-fixture-plan.test.mjs",
    "coach-dashboard-runner-behavior.test.mjs",
  ])
  const evidencePrefix = [".", "omo", ""].join("/")
  for (const name of names) {
    const source = await readFile(path.join(directory, name), "utf8")
    assert.ok(source.split(/\r?\n/u).length <= 250)
    assert.equal(source.includes(evidencePrefix), false)
  }
})

function successfulDependencies(observeInvocation) {
  return {
    collectVisuals: async () => ({
      files: [{ bytes: 1, name: "coach-dashboard-foundation-desktop.png", sha256: "a".repeat(64) }],
      verdict: "APPROVE",
    }),
    prepareRawOutput: async () => ({ cleanup: async () => {}, dir: "/private/raw" }),
    runPlaywright: async (invocation) => {
      observeInvocation(invocation)
      return { exitCode: 0, signal: null, stderr: "", stdout: fixtureEvent("happy") }
    },
    withLifecycle: async (_options, callback) => callback(lifecycleContext()),
  }
}

function fixtureEvent(scenario) {
  return `COACH_DASHBOARD_FIXTURE ${JSON.stringify({
    cleanup: cleanFixture,
    scenario,
  })}\n`
}

function lifecycleContext() {
  return {
    baseUrl: "http://127.0.0.1:3999",
    status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
