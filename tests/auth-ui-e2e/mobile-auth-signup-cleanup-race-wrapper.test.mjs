import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  mobileAuthJourneyPassed,
  sourceInventoryAllowedModifiedPaths,
  sourceInventoryAllowedPaths,
  sourceInventoryBaselinePath,
} from "./mobile-auth-signup-cleanup-race-contract.mjs"
import {
  aggregateApiPrerequisites,
  aggregateResultsApproved,
  buildAggregateCommands,
  commandResultApproved,
  focusedLifecycleContractTests,
  injectedFailureMatrix,
} from "./run-mobile-auth-signup-cleanup-race.mjs"
import {
  aggregateEntries,
  canonicalizeRedactedBaselinePath,
  collectSourceInventoryEntries,
  compareBaselineEntries,
  inventoryComparisonApproved,
  sourceInventoryPathExcluded,
  sourceInventoryPathIncluded,
} from "./verify-source-inventory.mjs"

test("Todo 4 journey contract rejects cleanup with unsettled profile or logout requests", () => {
  const settled = baseJourney()
  assert.equal(mobileAuthJourneyPassed(settled, false, false), true)

  assert.equal(
    mobileAuthJourneyPassed(
      { ...settled, requestSummary: { ...settled.requestSummary, pendingRequests: 1 } },
      false,
      false,
    ),
    false,
  )
  assert.equal(
    mobileAuthJourneyPassed(
      { ...settled, requestSummary: { ...settled.requestSummary, unexpectedFailures: 1 } },
      false,
      false,
    ),
    false,
  )
})

test("Todo 4 injected profile abort must be explicit and fully settled", () => {
  const injected = {
    ...baseJourney(),
    profileStatus: null,
    requestSummary: {
      expectedFailures: 1,
      pendingRequests: 0,
      profileAborts: 1,
      unexpectedFailures: 0,
    },
  }

  assert.equal(mobileAuthJourneyPassed(injected, false, true), true)
  assert.equal(mobileAuthJourneyPassed(injected, false, false), false)
  assert.equal(
    mobileAuthJourneyPassed(
      { ...injected, requestSummary: { ...injected.requestSummary, pendingRequests: 1 } },
      false,
      true,
    ),
    false,
  )
})

test("Todo 4 runner owns Playwright through lifecycle and records per-mode cleanup receipts", async () => {
  const source = await readFile("tests/auth-ui-e2e/run.mjs", "utf8")

  assert.equal(source.includes("lifecycle.runBrowserChild"), true)
  assert.equal(source.includes("cleanupReceiptPath"), true)
  assert.equal(source.includes("readJsonFile"), true)
  assert.equal(source.includes("SPOLINK_AUTH_E2E_INJECT_NAV_ABORT"), true)
  assert.equal(source.includes("SPOLINK_AUTH_E2E_PROFILE_DELAY_MS"), true)
  assert.equal(source.includes("Promise.all("), false)
})

test("Todo 5 source inventory and aggregate wrapper keep plan metadata outside scope", async () => {
  assert.equal((await stat(".omo/plans/mobile-auth-signup-cleanup-race.md")).isFile(), true)
  assert.equal(sourceInventoryPathIncluded(".omo/plans/mobile-auth-signup-cleanup-race.md"), false)
  assert.equal(sourceInventoryPathExcluded(".omo/plans/mobile-auth-signup-cleanup-race.md"), true)

  for (const filePath of [
    "tests/auth-ui-e2e/verify-source-inventory.mjs",
    "tests/auth-ui-e2e/run-mobile-auth-signup-cleanup-race.mjs",
  ]) {
    assert.equal((await stat(filePath)).isFile(), true)
    assert.equal(sourceInventoryAllowedPaths.includes(filePath), true)
  }
  assert.equal(
    sourceInventoryAllowedModifiedPaths.includes(
      "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-contract.mjs",
    ),
    true,
  )
  assert.equal(
    sourceInventoryAllowedModifiedPaths.includes(
      "tests/auth-ui-e2e/mobile-auth-signup-cleanup-race-wrapper.test.mjs",
    ),
    true,
  )
  for (const finalLifecyclePath of [
    "supabase/config.toml",
    "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
    "tests/auth-ui-e2e/lifecycle-failures.test.mjs",
  ]) {
    assert.equal(sourceInventoryAllowedModifiedPaths.includes(finalLifecyclePath), true)
  }
  assert.equal(
    sourceInventoryAllowedModifiedPaths.includes(
      "supabase/migrations/20260712000000_mvp_schema.sql",
    ),
    false,
  )
})

test("Todo 4 source inventory covers source, test, and config tree beyond fixed auth paths", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-inventory-"))
  try {
    await writeFixtureFile(
      repoRoot,
      "app/auth/signup/page.tsx",
      "export default function Page() {}\n",
    )
    await writeFixtureFile(repoRoot, "lib/supabase/server.ts", "export const server = true\n")
    await writeFixtureFile(repoRoot, "tests/auth-ui-e2e/run.mjs", "export const runner = true\n")
    await writeFixtureFile(repoRoot, "package.json", '{"scripts":{}}\n')
    await writeFixtureFile(repoRoot, "node_modules/ignored.js", "ignored\n")
    await writeFixtureFile(repoRoot, ".omo/evidence/ignored.json", "{}\n")
    await writeFixtureFile(repoRoot, ".omo/plans/ignored.md", "mutable plan metadata\n")

    const entries = await collectSourceInventoryEntries(repoRoot)
    const paths = entries.map((entry) => entry.path)

    assert.equal(paths.includes("app/auth/signup/page.tsx"), true)
    assert.equal(paths.includes("lib/supabase/server.ts"), true)
    assert.equal(paths.includes("tests/auth-ui-e2e/run.mjs"), true)
    assert.equal(paths.includes("package.json"), true)
    assert.equal(paths.includes("node_modules/ignored.js"), false)
    assert.equal(paths.includes(".omo/evidence/ignored.json"), false)
    assert.equal(paths.includes(".omo/plans/ignored.md"), false)
    assert.match(aggregateEntries(entries), /^[a-f0-9]{64}$/u)
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Todo 5 source inventory ignores plan edits but still rejects app lib and migration edits", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-inventory-plan-drift-"))
  try {
    await writeFixtureFile(
      repoRoot,
      "app/auth/signup/page.tsx",
      "export default function Page() {}\n",
    )
    await writeFixtureFile(repoRoot, "lib/supabase/server.ts", "export const server = true\n")
    await writeFixtureFile(repoRoot, "supabase/migrations/00000000000000_test.sql", "select 1;\n")
    await writeFixtureFile(repoRoot, "supabase/config.toml", 'project_id = "spolink"\n')
    await writeFixtureFile(repoRoot, "tests/auth-ui-e2e/run.mjs", "export const runner = true\n")
    await writeFixtureFile(repoRoot, ".omo/plans/todo5.md", "status: running\n")

    const baselineEntries = await collectSourceInventoryEntries(repoRoot)
    assert.equal(
      baselineEntries.some((entry) => entry.path === ".omo/plans/todo5.md"),
      false,
    )

    await writeFixtureFile(repoRoot, ".omo/plans/todo5.md", "status: still running\n")
    const planOnlyComparison = compareBaselineEntries(
      baselineEntries,
      await collectSourceInventoryEntries(repoRoot),
    )
    assert.equal(inventoryComparisonApproved(planOnlyComparison), true)

    await writeFixtureFile(
      repoRoot,
      "app/auth/signup/page.tsx",
      "export default function Page() { return null }\n",
    )
    await writeFixtureFile(repoRoot, "lib/supabase/server.ts", "export const server = false\n")
    await writeFixtureFile(repoRoot, "supabase/migrations/00000000000000_test.sql", "select 2;\n")
    await writeFixtureFile(repoRoot, "supabase/config.toml", 'project_id = "spolink-final"\n')
    const runtimeTreeComparison = compareBaselineEntries(
      baselineEntries,
      await collectSourceInventoryEntries(repoRoot),
    )
    assert.equal(inventoryComparisonApproved(runtimeTreeComparison), false)
    assert.equal(runtimeTreeComparison.allowedModified.includes("supabase/config.toml"), true)
    assert.deepEqual(runtimeTreeComparison.unexpectedModified, [
      "app/auth/signup/page.tsx",
      "lib/supabase/server.ts",
      "supabase/migrations/00000000000000_test.sql",
    ])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Todo 4 source inventory fails closed on out-of-fixed-list additions and changes", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-inventory-drift-"))
  try {
    await writeFixtureFile(
      repoRoot,
      "app/auth/signup/page.tsx",
      "export default function Page() {}\n",
    )
    await writeFixtureFile(repoRoot, "lib/supabase/server.ts", "export const server = true\n")
    await writeFixtureFile(repoRoot, "tests/auth-ui-e2e/run.mjs", "export const runner = true\n")

    const currentEntries = await collectSourceInventoryEntries(repoRoot)
    const appEntry = currentEntries.find((entry) => entry.path === "app/auth/signup/page.tsx")
    const runnerEntry = currentEntries.find((entry) => entry.path === "tests/auth-ui-e2e/run.mjs")
    assert.ok(appEntry)
    assert.ok(runnerEntry)

    const missingAppBaseline = [runnerEntry]
    const additionComparison = compareBaselineEntries(missingAppBaseline, currentEntries)
    assert.equal(inventoryComparisonApproved(additionComparison), false)
    assert.equal(additionComparison.unexpectedAdded.includes("app/auth/signup/page.tsx"), true)
    assert.equal(additionComparison.unexpectedAdded.includes("lib/supabase/server.ts"), true)

    const modifiedAppBaseline = [
      { path: appEntry.path, sha256: sha256("before\n") },
      currentEntries.find((entry) => entry.path === "lib/supabase/server.ts"),
      runnerEntry,
    ].filter(Boolean)
    const modificationComparison = compareBaselineEntries(modifiedAppBaseline, currentEntries)
    assert.equal(inventoryComparisonApproved(modificationComparison), false)
    assert.deepEqual(modificationComparison.unexpectedModified, ["app/auth/signup/page.tsx"])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("Todo 4 source inventory documents generated and runtime exclusions", () => {
  assert.equal(sourceInventoryPathIncluded("app/auth/signup/page.tsx"), true)
  assert.equal(sourceInventoryPathIncluded("lib/supabase/server.ts"), true)
  assert.equal(sourceInventoryPathIncluded("package.json"), true)
  assert.equal(sourceInventoryPathExcluded(".omo/evidence/run/source-inventory.json"), true)
  assert.equal(sourceInventoryPathExcluded(".next/cache/webpack/file"), true)
  assert.equal(sourceInventoryPathExcluded("supabase/.temp/project-ref"), true)
})

test("Todo 5 source inventory accepts redacted baseline aliases without changing current scope", () => {
  assert.equal(
    canonicalizeRedactedBaselinePath("app/auth/update-redacted/page.tsx"),
    "app/auth/update-password/page.tsx",
  )
  assert.equal(
    canonicalizeRedactedBaselinePath("tests/auth-ui-e2e/session-redacted-redacted.test-cases.mjs"),
    "tests/auth-ui-e2e/session-token-cookie.test-cases.mjs",
  )
  assert.equal(
    canonicalizeRedactedBaselinePath("app/auth/signup/page.tsx"),
    "app/auth/signup/page.tsx",
  )
})

test("Todo 4 aggregate wrapper preserves redaction, mode 0600, inventory, and stopped checks", async () => {
  const source = await readFile("tests/auth-ui-e2e/run-mobile-auth-signup-cleanup-race.mjs", "utf8")

  for (const token of [
    "assertRedactedMobileAuthReceipt",
    "writeJsonMode600",
    "computeMobileAuthSourceHash",
    "sourceInventoryBaselinePath",
    "tests/auth-ui-e2e/verify-source-inventory.mjs",
    "tests/auth-ui-e2e/run.mjs",
    "supabase:assert-stopped",
  ]) {
    assert.equal(source.includes(token), true, token)
  }
})

test("Todo 5 aggregate command plan includes every required gate and failure matrix", async () => {
  const commands = await buildAggregateCommands({
    outputDir: ".omo/evidence/mobile-auth-signup-cleanup-race/test-plan",
    runId: "todo5-command-plan",
  })
  const byName = new Map(commands.map((command) => [command.name, command]))

  for (const [name, invocation] of [
    ["typecheck", "corepack pnpm typecheck"],
    ["lint", "corepack pnpm lint"],
    ["build", "corepack pnpm build"],
    ["test-api", "corepack pnpm test:api"],
    ["test-e2e-auth", "corepack pnpm test:e2e:auth"],
    [
      "focused-lifecycle-contracts",
      `corepack pnpm exec node --test ${focusedLifecycleContractTests.join(" ")}`,
    ],
    [
      "canonical-auth-ui-runner",
      "corepack pnpm exec node tests/auth-ui-e2e/run.mjs .omo/evidence/mobile-auth-signup-cleanup-race/test-plan/todo5-command-plan-canonical-runner.json",
    ],
    [
      "source-inventory",
      `corepack pnpm exec node tests/auth-ui-e2e/verify-source-inventory.mjs .omo/evidence/mobile-auth-signup-cleanup-race/test-plan/todo5-command-plan-source-inventory.json ${sourceInventoryBaselinePath}`,
    ],
    ["supabase-assert-stopped", "corepack pnpm supabase:assert-stopped"],
  ]) {
    assert.equal(renderInvocation(byName.get(name)), invocation, name)
    assert.equal(byName.get(name)?.expectedExit, "zero", name)
  }

  assert.deepEqual(byName.get("test-api")?.prerequisites, aggregateApiPrerequisites)
  for (const scenario of injectedFailureMatrix) {
    const command = byName.get(scenario.name)
    assert.ok(command, scenario.name)
    assert.equal(command.category, "failure-matrix")
    assert.equal(command.expectedExit, scenario.expectedExit)
    assert.equal(command.expectedReceiptVerdict, scenario.expectedReceiptVerdict)
    assert.equal(command.requireCleanupReceipt, true)
    assert.deepEqual(command.env, scenario.env)
  }

  const commandNames = commands.map((command) => command.name)
  assert.deepEqual(commandNames, [
    "typecheck",
    "lint",
    "build",
    "canonical-auth-ui-runner",
    ...injectedFailureMatrix.map((scenario) => scenario.name),
    "focused-lifecycle-contracts",
    "auth-ui-node-contracts",
    "test-api",
    "test-e2e-auth",
    "source-inventory",
    "supabase-assert-stopped",
  ])

  const runtimeSensitiveCommands = [
    "canonical-auth-ui-runner",
    ...injectedFailureMatrix.map((scenario) => scenario.name),
  ]
  for (const mutableGate of ["test-api", "test-e2e-auth"]) {
    const mutableGateIndex = commandNames.indexOf(mutableGate)
    assert.notEqual(mutableGateIndex, -1, mutableGate)
    for (const runtimeCommand of runtimeSensitiveCommands) {
      assert.ok(commandNames.indexOf(runtimeCommand) < mutableGateIndex, runtimeCommand)
    }
  }
})

test("Todo 5 aggregate approval requires all required gates and expected injected outcomes", () => {
  const passing = [
    gateResult("typecheck", 0),
    gateResult("lint", 0),
    gateResult("build", 0),
    gateResult("test-api", 0),
    gateResult("test-e2e-auth", 0),
    gateResult("focused-lifecycle-contracts", 0),
    gateResult("auth-ui-node-contracts", 0),
    gateResult("canonical-auth-ui-runner", 0),
    failureMatrixResult("injected-failure-after-config", 1, "nonzero", "REJECT"),
    failureMatrixResult("injected-failure-after-next-ready", 1, "nonzero", "REJECT"),
    failureMatrixResult("injected-failure-after-mailpit-link", 1, "nonzero", "REJECT"),
    failureMatrixResult("expected-nav-abort", 0, "zero", "APPROVE"),
    gateResult("source-inventory", 0),
    gateResult("supabase-assert-stopped", 0),
  ]
  assert.equal(aggregateResultsApproved(passing), true)

  assert.equal(aggregateResultsApproved([...passing, gateResult("late-failing-lint", 1)]), false)
  assert.equal(
    commandResultApproved({
      exitCode: 0,
      expectedExit: "nonzero",
      expectedReceiptVerdict: "REJECT",
      receipt: { cleanup: { settled: true }, verdict: "APPROVE" },
      requireCleanupReceipt: true,
    }),
    false,
  )
  assert.equal(
    commandResultApproved({
      exitCode: 0,
      expectedExit: "zero",
      expectedReceiptVerdict: "APPROVE",
      receipt: { cleanup: { settled: true }, verdict: "APPROVE" },
      requireCleanupReceipt: true,
    }),
    true,
  )
  assert.equal(
    commandResultApproved({
      exitCode: 143,
      expectedExit: "nonzero",
      expectedReceiptVerdict: "REJECT",
      receipt: { cleanup: { settled: true }, verdict: "REJECT" },
      requireCleanupReceipt: true,
      signal: "SIGTERM",
    }),
    false,
  )
})

function baseJourney() {
  return {
    cleanup: { authUserDeleted: true, mailpitMessageDeleted: true, order: [] },
    identityMatched: true,
    navigationPathname: "/lessons",
    profilePersisted: true,
    profileStatus: 201,
    requestSummary: {
      expectedFailures: 0,
      pendingRequests: 0,
      profileAborts: 0,
      unexpectedFailures: 0,
    },
    signupSessionPresent: true,
    signupStatus: 200,
    status: "passed",
  }
}

async function writeFixtureFile(repoRoot, filePath, content) {
  const absolutePath = path.join(repoRoot, filePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function renderInvocation(command) {
  assert.ok(command)
  return `${command.command} ${command.args.join(" ")}`
}

function gateResult(name, exitCode) {
  return {
    approved: exitCode === 0,
    category: "required-gate",
    exitCode,
    name,
  }
}

function failureMatrixResult(name, exitCode, expectedExit, expectedReceiptVerdict) {
  return {
    approved: commandResultApproved({
      exitCode,
      expectedExit,
      expectedReceiptVerdict,
      receipt: { cleanup: { settled: true }, runId: name, verdict: expectedReceiptVerdict },
      requireCleanupReceipt: true,
    }),
    category: "failure-matrix",
    exitCode,
    name,
  }
}
