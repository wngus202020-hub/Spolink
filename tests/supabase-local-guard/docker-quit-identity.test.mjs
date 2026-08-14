import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  createRuntimeReceipt,
  runStop,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"
import { baseEnv, desktopSpawnRunner } from "./helpers.mjs"

for (const dockerOwnership of ["task-started", "task-installed"]) {
  test(`matching generic ${dockerOwnership} proof cannot quit a live preexisting daemon`, async () => {
    const calls = []
    const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
    try {
      const receiptPath = path.join(dir, "runtime.json")
      await writeRuntimeReceipt(
        receiptPath,
        createRuntimeReceipt({
          runId: `run-generic-${dockerOwnership}`,
          createdAt: new Date().toISOString(),
          dockerOwnership,
          dockerOwnershipProof: {
            runId: `run-generic-${dockerOwnership}`,
            initialDockerInfoExitCode: 1,
            action:
              dockerOwnership === "task-started" ? "open -a Docker" : "brew install --cask docker",
          },
          ownedRuntimeDirs: { runId: `run-generic-${dockerOwnership}`, paths: [] },
        }),
      )
      await assert.rejects(
        runStop({
          repoRoot: dir,
          env: baseEnv,
          receiptPath,
          spawnRunner: desktopSpawnRunner(calls, {
            docker: (spec) =>
              spec.args[0] === "info" && !spec.args.includes("--format")
                ? { exitCode: 1, stdout: "", stderr: "stopped" }
                : null,
          }),
          resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
          portChecker: async () => true,
        }),
        /daemon identity/i,
      )
      assert.equal(
        calls.some((call) => call.command === "osascript"),
        false,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
