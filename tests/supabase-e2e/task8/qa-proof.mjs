import { createHash } from "node:crypto"
import { mkdir, readFile, rm } from "node:fs/promises"

import { resolveSupabaseQaOutputDir } from "../../auth-ui-e2e/evidence-paths.mjs"
import { appendRedactedJsonLine, writeRedactedJson } from "../evidence-redaction.mjs"

export async function beginQaProof(metadataPath = null, externalFilesValidated = false) {
  const { outputDir, transcriptPath } = await qaPaths()
  await mkdir(outputDir, { recursive: true })
  await rm(transcriptPath, { force: true })
  await append({
    event: "metadata-validated",
    externalFilesValidated,
    metadataPathSha256: metadataPath ? sha256(metadataPath) : null,
  })
}

export async function recordHttpProof(label, status, body, transport = null) {
  await append({
    body,
    bodySha256: sha256(JSON.stringify(body)),
    event: label,
    status,
    transport,
  })
}

export async function recordDbProof(mode, proof) {
  await append({
    event: `db-${mode}`,
    querySha256: proof.querySha256,
    resultSha256: proof.resultSha256,
    snapshot: proof.snapshot,
  })
}

export async function recordReleaseProof() {
  try {
    const transcript = await readTranscript()
    if (transcript.some((entry) => entry.event === "release-written")) return
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  await append({ event: "release-written" })
}

export async function finalizeQaSuccess(cleanupPath) {
  const { successPath, transcriptPath } = await qaPaths()
  const transcript = await readTranscript()
  const byEvent = new Map(transcript.map((entry) => [entry.event, entry]))
  for (const event of [
    "configured",
    "unauthorized",
    "db-pristine",
    "cancellation",
    "db-cancelled",
  ]) {
    if (!byEvent.has(event)) throw new Error(`QA proof is missing ${event}`)
  }
  const cleanupSha256 = sha256(await readFile(cleanupPath))
  const summary = {
    cleanup: { path: cleanupPath, sha256: cleanupSha256 },
    configured: httpSummary(byEvent.get("configured")),
    db: {
      cancelled: dbSummary(byEvent.get("db-cancelled")),
      pristine: dbSummary(byEvent.get("db-pristine")),
    },
    qaCommand: "Todo8 exact QA-hold shell command",
    status: "SUCCESS",
    metadata: {
      externalFilesValidated: byEvent.get("metadata-validated")?.externalFilesValidated === true,
    },
    transcript: { path: transcriptPath, sha256: sha256(await readFile(transcriptPath)) },
    authenticatedCancellation: httpSummary(byEvent.get("cancellation")),
    unauthenticatedCancellation: httpSummary(byEvent.get("unauthorized")),
  }
  await writeRedactedJson(successPath, summary, [])
  return { path: successPath, summary }
}

export async function readQaSuccess() {
  const { successPath } = await qaPaths()
  return JSON.parse(await readFile(successPath, "utf8"))
}

export async function qaProofPaths() {
  const { successPath, transcriptPath } = await qaPaths()
  return Object.freeze({ successPath, transcriptPath })
}

async function append(record) {
  const { transcriptPath } = await qaPaths()
  await appendRedactedJsonLine(transcriptPath, record, [])
}

async function readTranscript() {
  const { transcriptPath } = await qaPaths()
  return (await readFile(transcriptPath, "utf8"))
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function httpSummary(record) {
  return { bodySha256: record.bodySha256, status: record.status, transport: record.transport }
}

function dbSummary(record) {
  return { querySha256: record.querySha256, resultSha256: record.resultSha256 }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function qaPaths() {
  const outputDir = await resolveSupabaseQaOutputDir()
  return {
    outputDir,
    transcriptPath: `${outputDir}/qa-hold-transcript.jsonl`,
    successPath: `${outputDir}/qa-hold-success-summary.json`,
  }
}
