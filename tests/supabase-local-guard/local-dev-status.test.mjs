import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { runStop } from "../../scripts/supabase-local/lifecycle.mjs"
import {
  LocalSupabaseNotRunningError,
  readGuardedLocalStatus,
} from "../../scripts/supabase-local/local-status.mjs"
import {
  createRuntimeReceipt,
  readRuntimeReceipt,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local/receipt.mjs"
import { baseEnv, copyConfigInto, desktopSpawnRunner, localStatusJson } from "./helpers.mjs"

test("baseline: guarded status and owned cleanup preserve lifecycle identity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-dev-local-baseline-"))
  const receiptPath = path.join(dir, "runtime.json")
  await copyConfigInto(dir)
  await writeRuntimeReceipt(
    receiptPath,
    createRuntimeReceipt({ runId: "run-baseline", dockerOwnership: "preexisting" }),
  )

  try {
    const status = await readGuardedLocalStatus({
      repoRoot: dir,
      env: baseEnv,
      statusJson: localStatusJson(),
    })
    const stop = await runStop({
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      runId: "run-baseline",
      spawnRunner: desktopSpawnRunner(),
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
    })

    assert.equal(status.apiUrl, "http://127.0.0.1:54321")
    assert.deepEqual(stop, { stopped: true, dockerOwnership: "preexisting" })
    assert.equal((await readRuntimeReceipt(receiptPath)).runId, "run-baseline")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("guarded status classifies only the verified CLI not-running signature", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-dev-local-status-"))
  await copyConfigInto(dir)
  const signature =
    "failed to inspect container health: Error response from daemon: " +
    "No such container: supabase_db_spolink"

  try {
    const absence = await rejectionOf(
      readGuardedLocalStatus({
        repoRoot: dir,
        env: baseEnv,
        spawnRunner: async () => ({ exitCode: 1, stdout: "", stderr: signature }),
      }),
    )
    assert.ok(absence instanceof LocalSupabaseNotRunningError)
    assert.equal(absence.code, "supabase_not_running")

    for (const result of [
      { exitCode: 124, stdout: "", stderr: signature },
      { exitCode: 127, stdout: "", stderr: "spawn corepack ENOENT" },
      { exitCode: 1, stdout: "", stderr: "unrelated status failure" },
      { exitCode: 0, stdout: "not-json", stderr: "" },
    ]) {
      const error = await rejectionOf(
        readGuardedLocalStatus({
          repoRoot: dir,
          env: baseEnv,
          spawnRunner: async () => result,
        }),
      )
      assert.equal(error instanceof LocalSupabaseNotRunningError, false)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail("Expected promise to reject")
}
