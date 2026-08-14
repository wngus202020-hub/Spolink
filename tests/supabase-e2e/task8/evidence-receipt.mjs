import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"

import { appendRedactedEvidence, writeRedactedJson } from "../evidence-redaction.mjs"
import { assertTask8QaProof } from "./evidence-semantics.mjs"

export const task8Paths = Object.freeze({
  canonical: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-regression.jsonl",
  cleanup: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/cleanup-receipt.json",
  debug: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/debug-hypotheses.json",
  doneClaim: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/done-claim.json",
  injected:
    ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/injected-failure-summary.json",
  log: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-regression.jsonl",
  qaShell:
    ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/qa/qa-hold-shell.raw.log",
  qaSuccess:
    ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/qa/qa-hold-success-summary.json",
  qaTranscript:
    ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/qa/qa-hold-transcript.jsonl",
  slop: ".omo/evidence/task-8-supabase-auth-ui-session-supabase-outputs/code-slop-report.json",
})

export async function readTask8QaBundle() {
  const summary = await readJson(task8Paths.qaSuccess)
  const transcriptText = await readFile(task8Paths.qaTranscript, "utf8")
  assert.equal(summary.transcript.path, task8Paths.qaTranscript)
  assert.equal(summary.transcript.sha256, sha256(transcriptText))
  const events = transcriptText
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const byEvent = new Map(events.map((event) => [event.event, event]))
  assert.equal(byEvent.get("metadata-validated")?.externalFilesValidated, true)
  assert.equal(byEvent.has("release-written"), true)
  const cleanupSha256 = sha256(await readFile(summary.cleanup.path))
  const proof = {
    cancellation: byEvent.get("cancellation"),
    cancelled: byEvent.get("db-cancelled"),
    cleanupSha256,
    configured: byEvent.get("configured"),
    pristine: byEvent.get("db-pristine"),
    summary,
    unauthorized: byEvent.get("unauthorized"),
  }
  assertTask8QaProof(proof)
  return proof
}

export async function finalizeTask8EvidenceReceipt() {
  const proof = await readTask8QaBundle()
  const cleanupSha256 = sha256(await readFile(task8Paths.cleanup))
  const artifacts = await readRequiredArtifacts()
  const payload = {
    artifacts,
    canonicalTask8: {
      path: task8Paths.canonical,
      sha256: sha256(await readFile(task8Paths.canonical)),
    },
    cleanup: { path: task8Paths.cleanup, sha256: cleanupSha256 },
    qa: {
      authenticatedCancellation: proof.summary.authenticatedCancellation,
      db: proof.summary.db,
      shell: artifacts.qaShell,
      successSummary: artifacts.qaSuccess,
      transcript: proof.summary.transcript,
      unauthenticatedCancellation: proof.summary.unauthenticatedCancellation,
    },
    schemaVersion: 1,
    task: 8,
    verdict: "REJECT_PENDING_SERIAL_QA",
  }
  await assertNoFinalVerdict(task8Paths.log)
  await writeRedactedJson(task8Paths.doneClaim, payload, [])
  const doneClaimSha256 = sha256(await readFile(task8Paths.doneClaim))
  await appendRedactedEvidence(
    task8Paths.log,
    {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      entryType: "final-verdict",
      command: "Todo8 corrective DoneClaim; REJECT pending serial QA",
      exitCode: 0,
      redactedOutputPath: task8Paths.doneClaim,
      redactedOutputSha256: doneClaimSha256,
      db: proof.summary.db.cancelled,
      http: withoutTransport(proof.summary.authenticatedCancellation),
      cleanup: {
        command: "corepack pnpm supabase:assert-stopped; verify ports and temp paths",
        exitCode: 0,
        proofSha256: cleanupSha256,
      },
      verdict: "REJECT",
    },
    [],
  )
  return { doneClaimSha256, task8LogSha256: sha256(await readFile(task8Paths.log)) }
}

async function readRequiredArtifacts() {
  const entries = {}
  for (const [key, filePath] of Object.entries({
    cleanup: task8Paths.cleanup,
    debug: task8Paths.debug,
    injectedFailure: task8Paths.injected,
    qaShell: task8Paths.qaShell,
    qaSuccess: task8Paths.qaSuccess,
    slop: task8Paths.slop,
  })) {
    entries[key] = { path: filePath, sha256: sha256(await readFile(filePath)) }
  }
  const injected = await readJson(task8Paths.injected)
  assert.equal(injected.status, "failure")
  return entries
}

async function assertNoFinalVerdict(filePath) {
  try {
    const lines = (await readFile(filePath, "utf8")).trim().split(/\n/).filter(Boolean)
    assert.equal(
      lines.some((line) => JSON.parse(line).verdict !== null),
      false,
    )
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"))
}

function withoutTransport(http) {
  return { bodySha256: http.bodySha256, status: http.status }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
