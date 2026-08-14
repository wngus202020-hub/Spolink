import assert from "node:assert/strict"
import { constants } from "node:fs"
import { access, readFile, stat } from "node:fs/promises"

import { appendRedactedEvidence } from "../evidence-redaction.mjs"
import { repoPath, sha256, shaPattern } from "./constants.mjs"
import { assertRecord } from "./records.mjs"

const preflightPath = ".omo/evidence/f4-supabase-auth-rls-e2e-preflight.json"
const finalPath = ".omo/evidence/f4-supabase-auth-rls-e2e-scope.md"
const requiredCommands = Object.freeze(["cleanup", "dependencies", "redaction"])

export async function createF4FinalFromPreflight(context) {
  await assertFileAbsent(context, finalPath)
  const preflight = await readPreflight(context)
  await assertPreflight(context, preflight)
  await appendRedactedEvidence(repoPath(context, finalPath), preflight.finalRecord, [])
  return {
    f4FinalPath: finalPath,
    f4FinalSha256: sha256(await readFile(repoPath(context, finalPath))),
  }
}

async function readPreflight(context) {
  const filePath = repoPath(context, preflightPath)
  const mode = (await stat(filePath)).mode & 0o777
  assert.equal(mode, 0o600, "F4 preflight receipt must be mode 0600")
  return JSON.parse(await readFile(filePath, "utf8"))
}

async function assertPreflight(context, preflight) {
  assert.equal(preflight.schemaVersion, 1)
  assert.equal(preflight.verdict, "READY")
  assert.deepEqual(preflight.commands.map((item) => item.name).sort(), requiredCommands)
  for (const command of preflight.commands) {
    assert.equal(command.exitCode, 0, `${command.name} command must succeed`)
    assert.match(command.outputSha256, shaPattern)
    assert.equal(
      sha256(await readFile(repoPath(context, command.outputPath))),
      command.outputSha256,
      `F4 command output hash mismatch: ${command.name}`,
    )
  }
  await assertF3Reference(context, preflight.f3)
  assertInvariants(preflight.invariants)
  assertRecord(preflight.finalRecord)
  assert.equal(preflight.finalRecord.entryType, "final-verdict")
  assert.equal(preflight.finalRecord.verdict, "APPROVE")
  assert.equal(
    preflight.finalRecord.redactedOutputSha256,
    sha256(await readFile(repoPath(context, preflight.finalRecord.redactedOutputPath))),
    "F4 final record output hash mismatch",
  )
}

async function assertF3Reference(context, f3) {
  assert.match(f3.sha256, shaPattern)
  assert.equal(sha256(await readFile(repoPath(context, f3.path))), f3.sha256)
  assert.match(f3.db.querySha256, shaPattern)
  assert.match(f3.db.resultSha256, shaPattern)
  assert.match(f3.http.bodySha256, shaPattern)
  assert.equal(Number.isInteger(f3.http.status), true)
}

function assertInvariants(invariants) {
  for (const key of [
    "cleanup",
    "dependencyVerification",
    "f3Refs",
    "secretScan",
    "sourceManifest",
  ]) {
    assert.equal(invariants[key], "PASS", `F4 invariant ${key} must PASS`)
  }
  assert.equal(invariants.providerRefundEdge, "NOT_CONFIGURED")
  assert.equal(invariants.port3002.before, invariants.port3002.after)
  assert.equal(invariants.ports.selectedNo3002, true)
  assert.equal(invariants.ports.unionFree, true)
  assert.equal(invariants.runtimeDirs.dotSupabase, "absent")
  assert.equal(invariants.runtimeDirs.supabaseTemp, "absent")
}

async function assertFileAbsent(context, filePath) {
  try {
    await access(repoPath(context, filePath), constants.F_OK)
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  throw new Error(`${filePath} already exists`)
}
