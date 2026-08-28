import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createRuntimeReceipt, writeRuntimeReceipt } from "../../scripts/supabase-local/receipt.mjs"
import { assertStoppedState } from "../../scripts/supabase-local/stopped-state.mjs"

test("assert-stopped rejects owned temp residue even while a current receipt exists", async () => {
  // Given: a stopped runtime receipt whose owned Supabase temp directory still exists.
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-stopped-temp-"))
  const receiptPath = path.join(repoRoot, "runtime-receipt.json")
  const tempDir = path.join(repoRoot, "supabase", ".temp")
  await mkdir(tempDir, { mode: 0o700, recursive: true })
  await writeFile(path.join(tempDir, "cli-latest"), "owned-residue", { mode: 0o600 })
  await writeRuntimeReceipt(
    receiptPath,
    createRuntimeReceipt({
      runId: "temp-residue-run",
      dockerOwnership: "preexisting",
      ownedRuntimeDirs: { runId: "temp-residue-run", paths: ["supabase/.temp"] },
    }),
  )

  try {
    // When/Then: status inspection rejects the residue without creating another marker.
    await assert.rejects(
      assertStoppedState({
        portChecker: async () => true,
        receiptPath,
        repoRoot,
        resourceScanner: async () => ({ containers: [], networks: [], volumes: [] }),
      }),
      /Runtime directory still exists.*supabase\/\.temp/u,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
