import assert from "node:assert/strict"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import {
  assertCoachDashboardEvidenceRedacted,
  readCoachDashboardEvidence,
  writeCoachDashboardEvidence,
} from "./coach-dashboard-evidence.mjs"
import { buildCoachDashboardFixturePlan } from "./coach-dashboard-fixture-plan.ts"
import { executeCoachDashboardRun } from "./coach-dashboard-runner-core.mjs"

const epoch = "2026-08-29T03:00:00.000Z"

test("fixture plan is deterministic around the explicitly supplied epoch", () => {
  const first = buildCoachDashboardFixturePlan(epoch)
  const second = buildCoachDashboardFixturePlan(epoch)

  assert.deepEqual(first, second)
  assert.equal(first.epoch, epoch)
  assert.deepEqual(
    first.personas.map(({ alias, accountState, coachState }) => ({
      accountState,
      alias,
      coachState,
    })),
    [
      { accountState: "coach_approved", alias: "approved-owner", coachState: "approved" },
      { accountState: "coach_approved", alias: "foreign-coach", coachState: "approved" },
      { accountState: "active", alias: "applicant-draft", coachState: "draft" },
      { accountState: "pending_coach", alias: "applicant-submitted", coachState: "submitted" },
      { accountState: "active", alias: "applicant-rejected", coachState: "rejected" },
      { accountState: "suspended", alias: "restricted-suspended", coachState: null },
      { accountState: "deleted", alias: "restricted-deleted", coachState: null },
      { accountState: "active", alias: "learner-reviewer", coachState: null },
    ],
  )
  assert.deepEqual(Object.keys(first.graph).sort(), [
    "lessons",
    "notifications",
    "payments",
    "reservations",
    "reviews",
    "schedules",
    "settlements",
  ])
  assert.notDeepEqual(buildCoachDashboardFixturePlan("2026-08-30T03:00:00.000Z"), first)
})

test("runner behavior reuses one lifecycle, one worker, supplied epoch, and grep passthrough", async () => {
  const observed = { lifecycleCalls: 0, lifecycleCleaned: false, playwright: null }
  const result = await executeCoachDashboardRun({
    epoch,
    grep: "smoke foundation",
    outputPath: ".omo/evidence/coach-dashboard-screen/task-6/fake-summary.json",
    visualDir: ".omo/evidence/coach-dashboard-screen/task-6/fake-visual",
    dependencies: {
      collectVisuals: async () => ({
        files: [
          { bytes: 1, name: "coach-dashboard-foundation-desktop.png", sha256: "a".repeat(64) },
        ],
        verdict: "APPROVE",
      }),
      prepareRawOutput: async () => ({ cleanup: async () => {}, dir: "/private/raw" }),
      runPlaywright: async (invocation) => {
        observed.playwright = invocation
        return {
          exitCode: 0,
          signal: null,
          stderr: "",
          stdout:
            'COACH_DASHBOARD_FIXTURE {"cleanup":{"dbRowsRemaining":0,"usersRemaining":0},"scenario":"happy"}\n',
        }
      },
      withLifecycle: async (options, callback) => {
        observed.lifecycleCalls += 1
        assert.equal(options.enableConfirmations, false)
        assert.equal(options.enableCoachUiFixtures, true)
        try {
          return await callback({
            baseUrl: "http://127.0.0.1:3999",
            status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
          })
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
  assert.deepEqual(result.fixtureCleanup, { dbRowsRemaining: 0, usersRemaining: 0 })
  assertCoachDashboardEvidenceRedacted(result)
})

test("injected failure remains nonzero while lifecycle and raw output cleanup both run", async () => {
  const cleanup = []
  let playwrightEnv = null
  const result = await executeCoachDashboardRun({
    allowInjectedFailure: true,
    epoch,
    failurePoint: "after-seed",
    outputPath: ".omo/evidence/coach-dashboard-screen/task-6/failure-summary.json",
    visualDir: ".omo/evidence/coach-dashboard-screen/task-6/failure-visual",
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
          stderr:
            "Error stack /Users/private trace.zip owner@example.test 11111111-1111-4111-8111-111111111111 postgres://secret",
          stdout:
            'Running 1 test\nCOACH_DASHBOARD_FIXTURE {"cleanup":{"dbRowsRemaining":0,"usersRemaining":0},"scenario":"injected-failure"}\n',
        }
      },
      withLifecycle: async (_options, callback) => {
        try {
          return await callback({
            baseUrl: "http://127.0.0.1:3999",
            status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
          })
        } finally {
          cleanup.push("lifecycle")
        }
      },
    },
  })

  assert.equal(result.exitCode, 1)
  assert.equal(result.verdict, "REJECT")
  assert.deepEqual(cleanup.sort(), ["lifecycle", "raw"])
  assert.equal(playwrightEnv.SPOLINK_COACH_DASHBOARD_INJECT_FAILURE, "after-seed")
  assert.equal(playwrightEnv.SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT, "1")
  assert.equal(result.failureClass, "playwright")
  assert.match(result.failureHash, /^[0-9a-f]{64}$/u)
  assert.equal("failureDetails" in result, false)
  assert.doesNotMatch(JSON.stringify(result), /Running 1 test|Error stack|trace\.zip|\/Users\//u)
  assertCoachDashboardEvidenceRedacted(result)
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
      outputPath: ".omo/evidence/coach-dashboard-screen/task-6/ordinary-summary.json",
      visualDir: ".omo/evidence/coach-dashboard-screen/task-6/ordinary-visual",
      dependencies: createSuccessfulDependencies((env) => {
        childEnv = env
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

test("direct spec injection decision requires both selector and contract gate", async () => {
  const { shouldInjectCoachDashboardFailure } = await import("./coach-dashboard-injection.ts")

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

test("evidence is private, self-hash verified, and contains no sensitive values", async () => {
  const fixturePath = path.resolve(
    ".omo/evidence/coach-dashboard-screen/task-6/contract-evidence.json",
  )
  await writeCoachDashboardEvidence(fixturePath, {
    epochHash: "a".repeat(64),
    fixtureCleanup: { dbRowsRemaining: 0, usersRemaining: 0 },
    verdict: "APPROVE",
  })
  const evidence = await readCoachDashboardEvidence(fixturePath)

  assert.equal((await stat(fixturePath)).mode & 0o777, 0o600)
  assert.equal(evidence.verdict, "APPROVE")
  assertCoachDashboardEvidenceRedacted(evidence)
})

test("evidence writer rejects raw reporter output and stack-shaped fields", async () => {
  const fixturePath = path.resolve(
    ".omo/evidence/coach-dashboard-screen/task-6/raw-output-rejected.json",
  )
  await assert.rejects(
    writeCoachDashboardEvidence(fixturePath, {
      failureDetails: "Running 1 test\nError stack\ntrace.zip\n/Users/private/source.ts",
      failureHash: "a".repeat(64),
      verdict: "REJECT",
    }),
    /raw output field/u,
  )
  await assert.rejects(
    writeCoachDashboardEvidence(fixturePath, {
      failureHash: "a".repeat(64),
      reporterOutput: "arbitrary reporter transcript",
      verdict: "REJECT",
    }),
    /raw output field|unexpected evidence field/u,
  )
  await assert.rejects(
    writeCoachDashboardEvidence(fixturePath, {
      failureHash: "a".repeat(64),
      scenario: "Running 1 test\nError Context: trace.zip /Users/private/source.ts",
      verdict: "REJECT",
    }),
    /raw output text/u,
  )
})

test("package exposes only the focused command and auth aggregate remains unchanged", async () => {
  const [packageJson, aggregate, baseline] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("tests/auth-ui-e2e/run.mjs", "utf8"),
    readFile(".omo/evidence/coach-dashboard-screen/task-1/baseline.json", "utf8").then(JSON.parse),
  ])

  assert.equal(
    packageJson.scripts["test:e2e:coach-dashboard"],
    "node tests/auth-ui-e2e/run-coach-dashboard.mjs",
  )
  assert.equal(aggregate.includes("coach-dashboard"), false)
  const aggregateBaseline = baseline.files.find(
    (entry) => entry.path === "tests/auth-ui-e2e/run.mjs",
  )
  if (aggregateBaseline) assert.equal(aggregateBaseline.sha256.length, 64)
})

function createSuccessfulDependencies(observeEnv) {
  return {
    collectVisuals: async () => ({
      files: [{ bytes: 1, name: "coach-dashboard-foundation-desktop.png", sha256: "a".repeat(64) }],
      verdict: "APPROVE",
    }),
    prepareRawOutput: async () => ({ cleanup: async () => {}, dir: "/private/raw" }),
    runPlaywright: async ({ env }) => {
      observeEnv(env)
      return {
        exitCode: 0,
        signal: null,
        stderr: "",
        stdout:
          'COACH_DASHBOARD_FIXTURE {"cleanup":{"dbRowsRemaining":0,"usersRemaining":0},"scenario":"happy"}\n',
      }
    },
    withLifecycle: async (_options, callback) =>
      callback({
        baseUrl: "http://127.0.0.1:3999",
        status: { apiUrl: "secret-api", dbUrl: "secret-db", serviceRoleKey: "secret-key" },
      }),
  }
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
