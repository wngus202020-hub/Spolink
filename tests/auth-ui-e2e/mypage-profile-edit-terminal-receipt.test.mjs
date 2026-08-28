import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { writeProfileEditTerminalReceipt } from "./mypage-profile-edit-terminal-receipt.mjs"
import { sha256 } from "./process.mjs"

test("second successful manifest refreshes the terminal receipt after support and visual bindings", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-terminal-receipt-"))
  const manifestPath = path.join(repoRoot, ".omo/evidence/mypage-profile-edit/task-7.json")
  const supportDir = path.join(path.dirname(manifestPath), "support")
  const supportPath = path.join(supportDir, "support-hash.json")
  const visualDir = path.join(path.dirname(manifestPath), "task-7-visual")
  const visualPath = path.join(visualDir, "profile-edit-success-desktop-chromium.png")

  try {
    await mkdir(supportDir, { mode: 0o700, recursive: true })
    await mkdir(visualDir, { mode: 0o700, recursive: true })
    await writeFile(supportPath, "support-run-1\n", { mode: 0o600 })
    await writeFile(visualPath, "visual-run-1\n", { mode: 0o600 })
    await writeManifest(manifestPath, "run-1")
    await writeProfileEditTerminalReceipt({ outputPath: manifestPath, visualDir })
    const firstReceipt = await readReceipt(manifestPath)

    await writeFile(supportPath, "support-run-2\n", { mode: 0o600 })
    await writeFile(visualPath, "visual-run-2\n", { mode: 0o600 })
    await writeManifest(manifestPath, "run-2")
    await writeProfileEditTerminalReceipt({ outputPath: manifestPath, visualDir })
    const secondReceipt = await readReceipt(manifestPath)

    assert.notEqual(firstReceipt.manifest.sha256, secondReceipt.manifest.sha256)
    assert.equal(secondReceipt.support[0].sha256, sha256(await readFile(supportPath)))
    assert.equal(secondReceipt.visual[0].sha256, sha256(await readFile(visualPath)))
    assert.equal(
      secondReceipt.support.some((entry) => entry.name.includes("closure-receipt")),
      false,
    )
  } finally {
    await rm(repoRoot, { force: true, recursive: true })
  }
})

async function writeManifest(manifestPath, runId) {
  const payload = {
    generatedAt: runId,
    schemaVersion: 1,
    verdict: "APPROVE",
  }
  const manifest = {
    ...payload,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(payload)),
    },
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  await chmod(manifestPath, 0o600)
}

async function readReceipt(manifestPath) {
  const receiptPath = path.join(
    path.dirname(manifestPath),
    "support/task-7-evidence-closure-receipt.json",
  )
  const receiptText = await readFile(receiptPath, "utf8")
  const receipt = JSON.parse(receiptText)
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600)
  assert.equal(receipt.manifest.sha256, sha256(await readFile(manifestPath)))
  assert.equal(receipt.manifest.selfHash, manifest.selfHash.value)
  return receipt
}
