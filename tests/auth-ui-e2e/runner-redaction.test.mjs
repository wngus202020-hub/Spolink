import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

import { buildChildEnv, runBuffered } from "./process.mjs"

const syntheticSecrets = Object.freeze({
  cookie: "Cookie: sb-access-token=synthetic-cookie-value",
  dbUrl: "postgresql://fixture_user:fixture_password@127.0.0.1:54322/postgres",
  email: "runner-failure@spolink.test",
  jwt: "eyJsyntheticHeader.syntheticPayload.syntheticSignature",
  password: "password=RunnerSecret!42",
  supabaseKey: "sb_secret_synthetic_fixture_key_0123456789",
  userId: "12345678-1234-4abc-8def-1234567890ab",
})
const sensitiveMessage = Object.values(syntheticSecrets).join(" | ")

for (const thrownKind of ["error", "non-error", "circular", "malformed-error"]) {
  test(`runner failure artifact and stderr expose only a stable category for ${thrownKind}`, async () => {
    // Given: the real runner boundaries receive a credential-bearing adversarial failure.
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "spolink-auth-runner-redaction-"))
    try {
      const bootstrapPath = await writeRunnerBootstrap(tempDir)

      // When: the canonical runner handles and prints the failure.
      const result = await runBuffered(
        process.execPath,
        [bootstrapPath, ".omo/evidence/runner-receipt.json"],
        {
          env: buildChildEnv(process.env, {
            SPOLINK_RUNNER_FAILURE_KIND: thrownKind,
            SPOLINK_RUNNER_FAILURE_MESSAGE: sensitiveMessage,
            SPOLINK_RUNNER_TEST_OUTPUT_DIR: tempDir,
          }),
          timeoutMs: 30_000,
        },
      )

      // Then: both serialized JSON and console output retain category, phase, and exit code only.
      assert.equal(result.exitCode, 1)
      const failurePath = path.join(tempDir, "runner-receipt.json")
      const artifact = await readFile(failurePath, "utf8")
      const summary = JSON.parse(artifact)
      assert.deepEqual(summary.error, {
        category: "auth-runner-failure",
        errorClass:
          thrownKind === "error"
            ? "Error"
            : thrownKind === "malformed-error"
              ? "Error"
              : "NonError",
        exitCode: 1,
        phase: "execution",
        title: "local-auth-runtime-e2e",
      })
      assert.deepEqual(JSON.parse(result.stderr.trim()), summary.error)
      assert.equal((await stat(failurePath)).mode & 0o777, 0o600)
      assert.equal(artifact.includes("stale-summary-marker"), false)
      assert.equal(result.stderr.includes("stale-summary-marker"), false)
      for (const secret of Object.values(syntheticSecrets)) {
        assert.equal(artifact.includes(secret), false, `artifact leaked ${secret}`)
        assert.equal(result.stderr.includes(secret), false, `stderr leaked ${secret}`)
      }
    } finally {
      await rm(tempDir, { force: true, recursive: true })
    }
  })
}

async function writeRunnerBootstrap(tempDir) {
  const runnerUrl = pathToFileURL(path.resolve("tests/auth-ui-e2e/run.mjs")).href
  const loaderSource = `
    const modules = {
      "../supabase-e2e/evidence-redaction.mjs": "export async function appendRedactedEvidence() {}",
      "../staging-contract/contract.mjs": "export function redactForEvidence(value) { return value }",
      "./evidence-paths.mjs": "export async function resolveAuthOutputDir() { return process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR } export async function resolveAuthEvidenceLog() { return process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR + '/evidence.jsonl' }",
      "./lifecycle.mjs": "import { writeFileSync } from 'node:fs'; export async function withConfiguredAuthMode() { const kind = process.env.SPOLINK_RUNNER_FAILURE_KIND; const message = process.env.SPOLINK_RUNNER_FAILURE_MESSAGE; writeFileSync(process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR + '/auth-e2e-failure-' + process.pid + '.json', JSON.stringify({ stale: 'stale-summary-marker' })); if (kind === 'error') throw new Error(message); if (kind === 'malformed-error') { const error = new Error(); Object.defineProperty(error, 'message', { get() { throw new Error(message) } }); Object.defineProperty(error, 'name', { get() { throw new Error(message) } }); throw error } if (kind === 'circular') { const value = {}; value.self = value; value.toString = () => message; throw value } throw message }",
      "./mobile-auth-signup-cleanup-race-contract.mjs": "export function assertRedactedMobileAuthReceipt() {} export async function computeMobileAuthSourceHash() { return 'a'.repeat(64) } export function createMobileAuthRunId() { return 'synthetic-run-id' } export function defaultMobileAuthReceiptPath() { return process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR + '/runner-receipt.json' } export function mobileAuthJourneyPassed() { return false } export function readMobileAuthJourneyResults() { return [] } export async function resolveMobileAuthReceiptPath() { return process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR + '/runner-receipt.json' }",
      "./raw-output.mjs": "export async function prepareRawPlaywrightOutputDir() { return { cleanup: async () => {}, dir: process.env.SPOLINK_RUNNER_TEST_OUTPUT_DIR } }",
    };
    export async function resolve(specifier, context, nextResolve) {
      if (context.parentURL === ${JSON.stringify(runnerUrl)} && modules[specifier]) {
        return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(modules[specifier]) };
      }
      return nextResolve(specifier, context);
    }
  `
  const bootstrapPath = path.join(tempDir, "bootstrap.mjs")
  const bootstrap = `
    import { register } from "node:module";
    register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loaderSource)}`)}, import.meta.url);
    await import(${JSON.stringify(runnerUrl)});
  `
  await writeFile(bootstrapPath, bootstrap, { mode: 0o600 })
  return bootstrapPath
}
