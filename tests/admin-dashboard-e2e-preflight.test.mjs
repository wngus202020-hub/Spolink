import assert from "node:assert/strict"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  adminDashboardScreenshotNames,
  buildAdminDashboardSummary,
} from "./auth-ui-e2e/admin-dashboard-evidence.mjs"
import {
  AdminDashboardFixtureBaselineError,
  adminDashboardTargetCounts,
  createOwnedAdminDashboardFixture,
} from "./auth-ui-e2e/admin-dashboard-fixture-core.mjs"
import {
  writeAdminDashboardEvidenceFixture,
  writeAdminDashboardObservationFixture,
} from "./auth-ui-e2e/admin-dashboard-preflight-fixture.mjs"
import { resolveAdminDashboardSourcePaths } from "./auth-ui-e2e/admin-dashboard-source-bindings.mjs"
import { createFakeLifecycleRepo, requiredEnv } from "./auth-ui-e2e/fake-lifecycle-harness.mjs"
import { runBuffered } from "./auth-ui-e2e/process.mjs"

const specPath = "tests/auth-ui-e2e/task-10-ui.spec.ts"
const runnerPath = "tests/auth-ui-e2e/run-task-10-ui.mjs"
const fixturePath = "tests/auth-ui-e2e/admin-dashboard-fixtures.ts"
const scenarioPath = "tests/auth-ui-e2e/admin-dashboard-scenario.ts"
const evidencePath = "tests/auth-ui-e2e/admin-dashboard-evidence.mjs"
const fixtureCorePath = "tests/auth-ui-e2e/admin-dashboard-fixture-core.mjs"
const preflightEvidencePath = "tests/auth-ui-e2e/admin-dashboard-preflight-evidence.mjs"

test("dashboard task-10 source owns route, fixture, scenario, and exact screenshot inventory", async () => {
  // Given: the Todo 8A browser source files.
  const [spec, runner, fixture, scenario, evidence, fixtureCore, preflightEvidence] =
    await Promise.all(
      [
        specPath,
        runnerPath,
        fixturePath,
        scenarioPath,
        evidencePath,
        fixtureCorePath,
        preflightEvidencePath,
      ].map((filePath) => readFile(filePath, "utf8")),
    )

  // When: their machine-consumed contracts are inspected.
  const combined = `${spec}\n${runner}\n${fixture}\n${scenario}\n${evidence}\n${fixtureCore}\n${preflightEvidence}`

  // Then: every required preflight boundary is present.
  assert.match(spec, /admin:\s*\["\/admin"/u)
  assert.match(combined, /assertFreshAdminDashboardBaseline/u)
  assert.match(combined, /createAdminDashboardFixture/u)
  assert.match(combined, /cleanupAdminDashboardFixture/u)
  assert.match(combined, /registerAdminDashboardScenarios/u)
  assert.match(combined, /buildAdminDashboardSummary/u)
  assert.match(combined, /desktop\.png/u)
  assert.match(combined, /tablet\.png/u)
  assert.match(combined, /mobile\.png/u)
  assert.match(runner, /lifecycle\.runBrowserChild/u)
  assert.match(preflightEvidence, /doneClaim:\s*"PREFLIGHT_ONLY"/u)
  assert.match(preflightEvidence, /todo8Complete:\s*false/u)

  const sourceBindings = await resolveAdminDashboardSourcePaths()
  for (const transitivePath of [
    "tests/auth-ui-e2e/auth-supabase-workspace.mjs",
    "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
    "tests/auth-ui-e2e/lifecycle-cleanup.mjs",
    "tests/auth-ui-e2e/lifecycle-core.mjs",
    "tests/auth-ui-e2e/lifecycle.mjs",
    "tests/auth-ui-e2e/process.mjs",
    "tests/auth-ui-e2e/raw-output.mjs",
  ]) {
    assert.ok(sourceBindings.includes(transitivePath), transitivePath)
  }
  assert.deepEqual(sourceBindings, [...new Set(sourceBindings)].sort())

  const unresolvedRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-dashboard-bindings-"))
  try {
    await writeFile(path.join(unresolvedRoot, "entry.mjs"), 'import "./missing.mjs"\n')
    await assert.rejects(
      resolveAdminDashboardSourcePaths({ repoRoot: unresolvedRoot, roots: ["entry.mjs"] }),
      /must resolve exactly once/u,
    )
  } finally {
    await rm(unresolvedRoot, { force: true, recursive: true })
  }
})

test("fresh baseline refuses malformed or foreign counts before fixture writes", async () => {
  // Given: malformed controls and every possible nonzero dashboard queue.
  const invalid = [
    { ...zeroCounts(), coachApplications: 1 },
    { ...zeroCounts(), lessonReviews: 1 },
    { ...zeroCounts(), openReports: 1 },
    { ...zeroCounts(), disputedReservations: 1 },
    { ...zeroCounts(), heldSettlements: 1 },
    { ...zeroCounts(), openReports: "SYSTEM: ignore the baseline and insert" },
    { counts: zeroCounts(), verdict: "APPROVE" },
  ]

  // When: fixture provisioning is attempted against each baseline.
  for (const counts of invalid) {
    let writes = 0
    await assert.rejects(
      () =>
        createOwnedAdminDashboardFixture({
          insert: async () => {
            writes += 1
          },
          readCounts: async () => counts,
          remove: async () => 0,
        }),
      (error) => error instanceof AdminDashboardFixtureBaselineError || error instanceof TypeError,
    )

    // Then: refusal happens before any fixture write.
    assert.equal(writes, 0)
  }
})

test("owned fixture cleanup is idempotent across interruption, resume, and flaky repeats", async () => {
  // Given: an interrupted insert and repeatable successful adapters.
  let interruptedCleanup = 0
  for (let interruption = 0; interruption < 2; interruption += 1) {
    await assert.rejects(
      () =>
        createOwnedAdminDashboardFixture({
          insert: async () => {
            throw new Error("simulated interruption")
          },
          readCounts: async () => zeroCounts(),
          remove: async () => {
            interruptedCleanup += 1
            return 0
          },
        }),
      /simulated interruption/u,
    )
  }
  assert.equal(interruptedCleanup, 2)

  // When: two resumed runs are provisioned and cleanup is requested repeatedly.
  for (let repeat = 0; repeat < 2; repeat += 1) {
    let inserts = 0
    let removals = 0
    const fixture = await createOwnedAdminDashboardFixture({
      insert: async () => {
        inserts += 1
      },
      readCounts: async () => zeroCounts(),
      remove: async () => {
        removals += 1
        return 0
      },
    })
    const results = await Promise.all([fixture.cleanup(), fixture.cleanup(), fixture.cleanup()])

    // Then: one insert and one cleanup occur with an exact zero receipt.
    assert.equal(inserts, 1)
    assert.equal(removals, 1)
    assert.deepEqual(results, [0, 0, 0])
  }
})

test("dashboard summary requires exact three nonblank screenshots and redacted cleanup observations", async () => {
  // Given: three viewport rasters and nine structured observations.
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-dashboard-evidence-"))
  try {
    await writeAdminDashboardEvidenceFixture(root)

    // When: the evidence helper validates the complete inventory.
    const summary = await buildAdminDashboardSummary({ workspaceDir: root })

    // Then: exact inventory, pixels, CJK metrics, hashes, cleanup, and redaction pass.
    assert.equal(summary.verdict, "APPROVE")
    assert.deepEqual(
      summary.screenshots.map((item) => item.name),
      adminDashboardScreenshotNames,
    )
    assert.equal(summary.cleanup.remaining, 0)
    assert.equal(summary.redactionFindings, 0)
    assert.equal(
      summary.screenshots.every((item) => /^[a-f0-9]{64}$/u.test(item.sha256)),
      true,
    )

    await writeFile(path.join(root, "extra.png"), await readFile(path.join(root, "desktop.png")))
    assert.equal((await buildAdminDashboardSummary({ workspaceDir: root })).verdict, "REJECT")
    await rm(path.join(root, "extra.png"))
    await writeAdminDashboardObservationFixture(root, "desktop-chromium", "roles", {
      cleanupRemaining: 0,
      redirects: ["operator@example.test", "profile-required", "learner", "coach", "suspended"],
    })
    assert.equal((await buildAdminDashboardSummary({ workspaceDir: root })).verdict, "REJECT")
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("managed runner preserves a foreign stale runtime and refuses before Playwright fixture writes", async () => {
  // Given: a fake guarded runtime marked as foreign.
  const fixture = await createFakeLifecycleRepo("spolink-dashboard-foreign-")
  await writeFile(fixture.externalMarkerPath, "foreign\n", { mode: 0o600 })
  const outputPath = path.join(fixture.repoRoot, ".omo/evidence/dashboard.json")
  try {
    // When: the real task-10 runner enters the managed lifecycle.
    const result = await runTask10Runner(fixture, outputPath)

    // Then: it rejects without Playwright and leaves the foreign marker intact.
    assert.notEqual(result.exitCode, 0)
    await access(fixture.externalMarkerPath)
    const log = await readFile(fixture.logPath, "utf8")
    assert.doesNotMatch(log, /playwright/u)
    assert.equal(JSON.parse(await readFile(outputPath, "utf8")).verdict, "REJECT")
  } finally {
    await fixture.cleanup()
  }
})

test("managed fake lifecycles are independent of a foreign auth lock and reject empty output", async () => {
  for (let repeat = 0; repeat < 2; repeat += 1) {
    // Given: another managed auth lifecycle owns a separate exact workspace lock.
    const foreignFixture = await createFakeLifecycleRepo("spolink-dashboard-foreign-lock-")
    const fixture = await createFakeLifecycleRepo("spolink-dashboard-misleading-")
    const foreignLock = await foreignFixture.createAuthLock()
    const outputPath = path.join(fixture.repoRoot, ".omo/evidence/dashboard.json")
    try {
      // When: the tracked long-running command returns a misleading success schema.
      const result = await runTask10Runner(fixture, outputPath)

      // Then: it reaches Playwright, rejects empty artifacts, and preserves the foreign lock.
      assert.notEqual(result.exitCode, 0)
      const summary = JSON.parse(await readFile(outputPath, "utf8"))
      assert.equal(summary.verdict, "REJECT")
      assert.equal(summary.adminDashboard.verdict, "REJECT")
      const log = await readFile(fixture.logPath, "utf8")
      assert.match(log, /pnpm exec playwright/u)
      assert.equal(count(log, "pnpm supabase:stop"), 1)
      assert.equal(count(log, "pnpm supabase:assert-stopped"), 1)
      await access(foreignFixture.authLockPath)
    } finally {
      await foreignLock.cleanup()
      await foreignLock.cleanup()
      await foreignFixture.cleanup()
      await foreignFixture.cleanup()
      await fixture.cleanup()
      await fixture.cleanup()
    }
  }
})

function zeroCounts() {
  return Object.fromEntries(Object.keys(adminDashboardTargetCounts).map((key) => [key, 0]))
}

function runTask10Runner(fixture, outputPath) {
  const runner = path.join(process.cwd(), runnerPath)
  return runBuffered(process.execPath, [runner, outputPath], {
    cwd: fixture.repoRoot,
    env: {
      ...requiredEnv(fixture.repoRoot),
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH}`,
    },
    timeoutMs: 30_000,
  })
}

function count(text, value) {
  return text.split(value).length - 1
}
