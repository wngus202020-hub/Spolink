import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { repoPath, sha256, shaPattern } from "./constants.mjs"

export async function readRemediationManifest(context) {
  const manifestPath = ".omo/evidence/task-7-resume-3-security-remediation-manifest.json"
  const manifest = JSON.parse(await readFile(repoPath(context, manifestPath), "utf8"))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(
    manifest.historicalReferencePolicy.status,
    "INTENTIONALLY_INVALIDATED_NON_AUTHORITATIVE",
  )
  for (const item of manifest.affected) {
    assert.match(item.newSha256, shaPattern)
    assert.equal(
      sha256(await readFile(repoPath(context, item.path))),
      item.newSha256,
      `security-remediation rehash mismatch: ${item.path}`,
    )
  }
  return new Map(manifest.affected.map((item) => [item.path, item]))
}
