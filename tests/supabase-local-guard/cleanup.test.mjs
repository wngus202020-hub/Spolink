import assert from "node:assert/strict"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createRuntimeReceipt,
  runStop,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"
import { baseEnv, desktopSpawnRunner } from "./helpers.mjs"

test("preexisting stop removes stale zero-resource receipt without using it as proof", async () => {
  const calls = []
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    const zeroPath = path.join(dir, "runtime-zero-resources-supabase-auth-rls-e2e.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-preexisting",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
        ownedRuntimeDirs: { runId: "run-preexisting", paths: [] },
      }),
    )
    await writeFile(
      zeroPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "stale-run",
        containers: 0,
        volumes: 0,
        networks: 0,
        portsFree: true,
      }),
      { mode: 0o600 },
    )
    await runStop({
      repoRoot: dir,
      env: baseEnv,
      receiptPath,
      spawnRunner: desktopSpawnRunner(calls),
      resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
      portChecker: async () => true,
    })
    await assert.rejects(access(zeroPath), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
