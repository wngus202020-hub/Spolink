import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  applyAuthConfigMode,
  assertAuthConfigDelta,
  assertNoExternalTestBaseUrl,
  restoreConfigSnapshot,
} from "./config-mode.mjs"
import { finalQaProjects, finalQaScenarioNames } from "./contracts.mjs"
import {
  resolveAuthOutputDir,
  resolveEvidenceChildPath,
  resolveSupabaseEvidenceLog,
  resolveSupabaseOutputDir,
} from "./evidence-paths.mjs"
import {
  buildApiTestEnv,
  createRunManifest,
  describeCleanupFailure,
  resolveCleanupReceiptPath,
} from "./lifecycle.mjs"
import { isLoopbackPortFree, reserveLoopbackPort } from "./ports.mjs"
import { writeJsonMode600 } from "./process.mjs"
import { writeFinalQaSummary } from "./run-final-qa.mjs"
import { missingFiles } from "./run-review-lanes.mjs"

test("owned port reservation returns a free loopback origin that is never 3002", async () => {
  const reservation = await reserveLoopbackPort()
  try {
    assert.equal(reservation.baseUrl, `http://127.0.0.1:${reservation.port}`)
    assert.notEqual(reservation.port, 3002)
    assert.equal(await isLoopbackPortFree(reservation.port), false)
  } finally {
    await reservation.release()
  }
  assert.equal(await isLoopbackPortFree(reservation.port), true)
})

test("auth config mode changes only callbacks and confirmation flag then restores bytes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "spolink-auth-config-"))
  const configPath = path.join(tempDir, "config.toml")
  const original = `[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]

[auth.email]
enable_signup = true
enable_confirmations = false
`
  await writeFile(configPath, original, { mode: 0o600 })
  const { after, snapshot } = await applyAuthConfigMode({
    baseUrl: "http://127.0.0.1:3999",
    enableConfirmations: true,
    filePath: configPath,
  })
  assert.deepEqual(
    assertAuthConfigDelta(snapshot.text, after.text, {
      baseUrl: "http://127.0.0.1:3999",
      enableConfirmations: true,
    }).changedPaths,
    ["auth.additional_redirect_urls", "auth.email.enable_confirmations", "auth.site_url"],
  )
  await restoreConfigSnapshot(snapshot)
  assert.equal(await readFile(configPath, "utf8"), original)
  await rm(tempDir, { force: true, recursive: true })
})

test("auth config mode restores bytes after simulated error", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "spolink-auth-error-"))
  const configPath = path.join(tempDir, "config.toml")
  const original = `[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]

[auth.email]
enable_confirmations = false
`
  await writeFile(configPath, original, { mode: 0o600 })
  const { snapshot } = await applyAuthConfigMode({
    baseUrl: "http://127.0.0.1:3888",
    enableConfirmations: false,
    filePath: configPath,
  })
  await restoreConfigSnapshot(snapshot)
  assert.equal(await readFile(configPath, "utf8"), original)
  await rm(tempDir, { force: true, recursive: true })
})

test("evidence overrides reject external traversal and symlink paths", async () => {
  await assert.rejects(
    () => resolveEvidenceChildPath("/tmp/spolink-auth-output.json", { kind: "file" }),
    /beneath \.omo\/evidence/,
  )
  const symlinkPath = ".omo/evidence/auth-harness-symlink"
  await rm(symlinkPath, { force: true, recursive: true })
  await symlink(os.tmpdir(), symlinkPath)
  try {
    await assert.rejects(
      () => resolveEvidenceChildPath(`${symlinkPath}/output.json`, { kind: "file" }),
      /symlink/,
    )
  } finally {
    await rm(symlinkPath, { force: true })
  }
})

test("evidence root rejects a symlinked .omo ancestor outside the canonical repository", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-evidence-root-"))
  const outside = await mkdtemp(path.join(os.tmpdir(), "spolink-evidence-outside-"))
  await mkdir(path.join(outside, "evidence"))
  await symlink(outside, path.join(repoRoot, ".omo"))
  try {
    await assert.rejects(
      resolveEvidenceChildPath(".omo/evidence/summary.json", { kind: "file", repoRoot }),
      /\.omo must be a real directory|canonical repository/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
    await rm(outside, { force: true, recursive: true })
  }
})

test("mode-0600 JSON writer rejects a final-component symlink swapped after resolution", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-evidence-swap-"))
  const evidenceRoot = path.join(repoRoot, ".omo/evidence")
  const outside = path.join(repoRoot, "outside.json")
  await mkdir(evidenceRoot, { mode: 0o700, recursive: true })
  await writeFile(outside, "untouched", { mode: 0o600 })
  const resolved = await resolveEvidenceChildPath(".omo/evidence/summary.json", {
    kind: "file",
    repoRoot,
  })
  await symlink(outside, resolved)
  try {
    await assert.rejects(
      writeJsonMode600(resolved, { verdict: "APPROVE" }, { repoRoot }),
      /symlink|no-follow|real file/u,
    )
    assert.equal(await readFile(outside, "utf8"), "untouched")
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("cleanup receipts use the canonical evidence resolver", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-cleanup-receipt-"))
  await mkdir(path.join(repoRoot, ".omo/evidence"), { mode: 0o700, recursive: true })
  try {
    assert.equal(
      await resolveCleanupReceiptPath(".omo/evidence/run.cleanup.json", repoRoot),
      path.join(repoRoot, ".omo/evidence/run.cleanup.json"),
    )
    await assert.rejects(
      resolveCleanupReceiptPath(path.join(repoRoot, "cleanup.json"), repoRoot),
      /beneath \.omo\/evidence/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("default output paths use auth-ui-session names instead of legacy task-8 paths", async () => {
  const saved = {
    SPOLINK_AUTH_E2E_OUTPUT_DIR: process.env.SPOLINK_AUTH_E2E_OUTPUT_DIR,
    SPOLINK_E2E_EVIDENCE_LOG: process.env.SPOLINK_E2E_EVIDENCE_LOG,
    SPOLINK_E2E_OUTPUT_DIR: process.env.SPOLINK_E2E_OUTPUT_DIR,
  }
  delete process.env.SPOLINK_AUTH_E2E_OUTPUT_DIR
  delete process.env.SPOLINK_E2E_EVIDENCE_LOG
  delete process.env.SPOLINK_E2E_OUTPUT_DIR
  try {
    const authOutputDir = await resolveAuthOutputDir()
    const supabaseOutputDir = await resolveSupabaseOutputDir()
    const supabaseEvidenceLog = await resolveSupabaseEvidenceLog()
    for (const resolved of [authOutputDir, supabaseOutputDir, supabaseEvidenceLog]) {
      assert.match(resolved, /supabase-auth-ui-session/)
      assert.doesNotMatch(resolved, /task-8/)
    }
  } finally {
    restoreEnv(saved)
  }
})

test("run-api-tests child environment injects only the owned base URL and local Supabase status", () => {
  const env = buildApiTestEnv(
    { HOME: "/tmp/home", PATH: "/bin", TMPDIR: "/tmp" },
    "http://127.0.0.1:3777",
    { anonKey: "anon", apiUrl: "http://127.0.0.1:54321" },
  )
  assert.deepEqual(env, {
    HOME: "/tmp/home",
    PATH: "/bin",
    TMPDIR: "/tmp",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NODE_ENV: "test",
    SPOLINK_TEST_BASE_URL: "http://127.0.0.1:3777",
  })
})

test("auth lifecycle rejects external SPOLINK_TEST_BASE_URL ownership", () => {
  assert.throws(
    () => assertNoExternalTestBaseUrl({ SPOLINK_TEST_BASE_URL: "http://127.0.0.1:3006" }),
    /SPOLINK_TEST_BASE_URL is rejected/,
  )
})

test("auth lifecycle manifest has the exact per-run ownership shape", () => {
  const manifest = createRunManifest({
    configSnapshotHash: "a".repeat(64),
    evidencePaths: [".omo/evidence/run/receipt.json"],
    mode: "confirmation-off",
    runId: "todo2-shape",
  })

  assert.deepEqual(manifest, {
    runId: "todo2-shape",
    mode: "confirmation-off",
    authUserId: null,
    profileId: null,
    mailpitMessageIds: [],
    configSnapshotHash: "a".repeat(64),
    ownedPids: [],
    tempPaths: [],
    evidencePaths: [".omo/evidence/run/receipt.json"],
  })
  assert.deepEqual(Object.keys(manifest), [
    "runId",
    "mode",
    "authUserId",
    "profileId",
    "mailpitMessageIds",
    "configSnapshotHash",
    "ownedPids",
    "tempPaths",
    "evidencePaths",
  ])
})

test("auth lifecycle manifest rejects malformed run identity", () => {
  assert.throws(
    () => createRunManifest({ mode: "confirmation-off", runId: "" }),
    /runId is required/,
  )
  assert.throws(() => createRunManifest({ mode: "", runId: "todo2" }), /mode is required/)
  assert.throws(
    () =>
      createRunManifest({
        mode: "confirmation-off",
        runId: "todo2",
        tempPaths: ["/tmp/arbitrary"],
      }),
    /Arbitrary temp paths are rejected/u,
  )
})

test("cleanup failure remains terminal after a prior lifecycle failure", () => {
  const message = describeCleanupFailure({
    after3002: "before",
    before3002: "before",
    cleanupErrors: [],
    stop: { exitCode: 0, stderr: "" },
    stopped: { exitCode: 1, stderr: "still running" },
  })
  assert.match(message, /Auth lifecycle cleanup failed/)
  assert.match(message, /supabase:assert-stopped failed/)
})

test("review security precheck reports every missing named security test before execution", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "spolink-security-precheck-"))
  const present = path.join(tempDir, "present.test.mjs")
  const missing = path.join(tempDir, "missing.test.mjs")
  await writeFile(present, "import test from 'node:test'\ntest('present', () => {})\n")
  assert.deepEqual(await missingFiles([present, missing]), [missing])
  await rm(tempDir, { force: true, recursive: true })
})

test("final QA runner rejects incomplete browser scenarios and writes a REJECT summary", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "spolink-final-qa-"))
  const summaryPath = path.join(tempDir, "summary.json")
  try {
    const verdict = await writeFinalQaSummary(summaryPath, {
      exitCode: 1,
      signal: null,
      stderr: "synthetic child failure",
      stdout: JSON.stringify({ suites: [] }),
    })
    assert.equal(verdict, "REJECT")
    const summary = JSON.parse(await readFile(summaryPath, "utf8"))
    assert.equal(summary.verdict, "REJECT")
    assert.equal(summary.runtimeObserved, false)
    assert.equal(summary.scenarios.length, finalQaProjects.length * finalQaScenarioNames.length)
    assert.ok(summary.scenarios.some((item) => item.verdict === "REJECT"))
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
})

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (typeof value === "string") {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
}
