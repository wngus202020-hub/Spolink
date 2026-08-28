import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { createRuntimeReceipt, writeRuntimeReceipt } from "../../scripts/supabase-local/receipt.mjs"
import { recordOwnedNext } from "./next-server.mjs"
import { releaseRecordedNextOwnership } from "./task8/receipt-ownership.mjs"

test("unconfigured Next can start from a clean stopped state without a runtime receipt", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-next-receipt-"))
  try {
    await recordOwnedNext(repoRoot, { ownedPid: process.pid, port: 3006 })
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("an invalid present runtime receipt still fails closed", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-next-receipt-"))
  const receiptPath = path.join(
    repoRoot,
    ".omo/evidence/runtime-receipt-supabase-auth-rls-e2e.json",
  )
  try {
    await mkdir(path.dirname(receiptPath), { recursive: true })
    await writeFile(receiptPath, "{}\n", { mode: 0o600 })
    await assert.rejects(recordOwnedNext(repoRoot, { ownedPid: process.pid, port: 3006 }))
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

test("full runner releases only its recorded Next children from a reused runtime receipt", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-next-receipt-"))
  const receiptPath = path.join(
    repoRoot,
    ".omo/evidence/runtime-receipt-supabase-auth-rls-e2e.json",
  )
  try {
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        dockerOwnership: "preexisting",
        ownedPids: [101, 202, 303],
        runId: "test-reused-runtime",
        selectedNextPorts: [3006, 3007, 3999],
      }),
    )
    await releaseRecordedNextOwnership(
      [
        { pid: 101, port: 3006 },
        { pid: 202, port: 3007 },
      ],
      repoRoot,
    )
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"))
    assert.deepEqual(receipt.ownedPids, [303])
    assert.deepEqual(receipt.selectedNextPorts, [3999])
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})
