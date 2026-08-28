import assert from "node:assert/strict"
import { access, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import {
  accessRawOutputDir,
  assertNoSensitiveMaterial,
  childTestEnv,
  createMode700TempDir,
  packagePath,
  profileSpec,
  projects,
  readPlaywrightInvocation,
  removeTempDir,
  runFakeProfileRunner,
} from "./mypage-profile-edit-runner-fixture.mjs"
import { runBuffered, sha256 } from "./process.mjs"

test("package script adds only the focused profile edit command while preserving existing scripts", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"))
  const scripts = packageJson.scripts ?? {}
  assert.equal(
    scripts["test:e2e:profile-edit"],
    "node tests/auth-ui-e2e/run-mypage-profile-edit.mjs",
  )
  for (const [name, command] of Object.entries({
    "test:e2e:auth":
      "node tests/auth-ui-e2e/run.mjs && node tests/auth-ui-e2e/run-booking-confirmation.mjs && node tests/auth-ui-e2e/run-coach-certification.mjs",
    "test:e2e:payment": "node tests/auth-ui-e2e/run-payment-preparation.mjs",
    "test:e2e:reservations": "node tests/auth-ui-e2e/run-learner-reservations.mjs",
    "test:e2e:high-priority":
      "node tests/auth-ui-e2e/run-task-10-ui.mjs .omo/evidence/high-priority-missing-services/task-10/ui.json",
    "test:high-priority:contracts": "node tests/high-priority-missing-services/run-contracts.mjs",
  })) {
    assert.equal(scripts[name], command)
  }
})

test("fake buffered Playwright success writes a mode-0600 APPROVE hash summary and cleans owned raw output", async () => {
  const result = await runFakeProfileRunner("success")
  try {
    assert.equal(result.exitCode, 0, result.stderr)
    const summaryText = await readFile(result.outputPath, "utf8")
    const summary = JSON.parse(summaryText)
    assert.equal(summary.verdict, "APPROVE")
    assert.equal(summary.visualPublication.verdict, "APPROVE")
    assert.deepEqual(summary.projects, projects)
    assert.deepEqual(summary.specs, [profileSpec])
    assert.match(summary.resultHash, /^[a-f0-9]{64}$/u)
    assertNoSensitiveMaterial(summaryText)
    const receiptPath = path.join(
      path.dirname(result.outputPath),
      "support/task-7-evidence-closure-receipt.json",
    )
    const receiptText = await readFile(receiptPath, "utf8")
    assert.equal(JSON.parse(receiptText).manifest.sha256, sha256(summaryText))
    assert.deepEqual(await readPlaywrightInvocation(result.logPath), {
      projects,
      spec: profileSpec,
      workers: "1",
    })
    await assert.rejects(() => accessRawOutputDir(result.rawMarkerPath), /ENOENT/u)
  } finally {
    await result.cleanup()
  }
})

test("fake buffered Playwright failure retains only redacted failure categories", async () => {
  const result = await runFakeProfileRunner("report-failure")
  try {
    assert.equal(result.exitCode, 1, result.stderr)
    const summaryText = await readFile(result.outputPath, "utf8")
    const summary = JSON.parse(summaryText)
    assert.equal(summary.verdict, "REJECT")
    assert.deepEqual(summary.playwrightReport.failureSummary, [
      {
        errorCategory: "assertion",
        project: "desktop-chromium",
        status: "failed",
        step: "visible-assertion",
        title: "profile edit journey saves changed-only fields and persists after retry",
      },
    ])
    assertNoSensitiveMaterial(summaryText)
    assert.doesNotMatch(summaryText, /\/Users\/|spolink-profile-edit-runner-|line \d+/u)
  } finally {
    await result.cleanup()
  }
})

test("runner removes only Supabase temp residue created during its own run", async () => {
  const created = await runFakeProfileRunner("success", { createSupabaseTemp: true })
  try {
    assert.equal(created.exitCode, 0, created.stderr)
    await assert.rejects(
      () => access(path.join(created.repoRoot, "supabase/.temp/cli-latest")),
      /ENOENT/u,
    )
  } finally {
    await created.cleanup()
  }

  const preserved = await runFakeProfileRunner("success", {
    createSupabaseTemp: true,
    preexistingSupabaseTemp: true,
  })
  try {
    assert.equal(preserved.exitCode, 0, preserved.stderr)
    assert.equal(
      await readFile(path.join(preserved.repoRoot, "supabase/.temp/cli-latest"), "utf8"),
      "preexisting\n",
    )
  } finally {
    await preserved.cleanup()
  }
})

for (const [mode, expectedExit] of [
  ["nonzero", 1],
  ["signal", 1],
  ["malformed-child-result", 1],
  ["misleading-zero-exit", 1],
  ["stale-output", 1],
]) {
  test(`fake buffered Playwright ${mode} writes REJECT and cleans owned raw output`, async () => {
    const result = await runFakeProfileRunner(mode)
    try {
      assert.equal(result.exitCode, expectedExit, result.stderr)
      const summaryText = await readFile(result.outputPath, "utf8")
      const summary = JSON.parse(summaryText)
      assert.equal(summary.verdict, "REJECT")
      assert.match(summary.resultHash, /^[a-f0-9]{64}$/u)
      assertNoSensitiveMaterial(summaryText)
      await assert.rejects(() => accessRawOutputDir(result.rawMarkerPath), /ENOENT/u)
    } finally {
      await result.cleanup()
    }
  })
}

test("two focused runner contract processes can run concurrently with isolated fixture output", async () => {
  const args = [
    "--test",
    "--test-name-pattern",
    "^fake buffered Playwright success writes",
    "tests/auth-ui-e2e/mypage-profile-edit-runner.test.mjs",
  ]
  const [left, right] = await Promise.all([
    runBuffered(process.execPath, args, { env: childTestEnv(), timeoutMs: 30_000 }),
    runBuffered(process.execPath, args, { env: childTestEnv(), timeoutMs: 30_000 }),
  ])

  for (const result of [left, right]) {
    assert.equal(result.exitCode, 0, result.stderr)
    assert.match(`${result.stdout}${result.stderr}`, /pass 1/u)
    assert.match(`${result.stdout}${result.stderr}`, /fail 0/u)
  }
})

test("caller-supplied raw output is retained without exposing its path by default", async () => {
  const suppliedRawDir = await createMode700TempDir("spolink-profile-edit-supplied-")
  const result = await runFakeProfileRunner("success", {
    extraEnv: { SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: suppliedRawDir },
  })
  try {
    assert.equal(result.exitCode, 0, result.stderr)
    const summary = JSON.parse(await readFile(result.outputPath, "utf8"))
    assert.equal(summary.verdict, "APPROVE")
    assert.equal(summary.rawOutputDirRetained, "<caller-supplied>")
    assert.deepEqual((await readdir(suppliedRawDir)).sort(), [".last-run.json"])
  } finally {
    await result.cleanup()
    await removeTempDir(suppliedRawDir)
  }
})
