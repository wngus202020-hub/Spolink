import assert from "node:assert/strict"
import { rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { redactPlaywrightTrace } from "../redact-playwright-trace.mjs"
import { buildPublishedArtifactNames } from "./config.mjs"

export async function finalizeTraceEvidence(context, browserContext) {
  const tracePath = path.join(context.config.stagingDir, "public-gallery-trace.zip")
  await browserContext.tracing.stop({ path: tracePath })
  context.report.traceRedaction = await redactPlaywrightTrace(tracePath, [
    context.config.runId,
    context.fixture.coachId ?? "",
    context.fixture.coachProfileId,
    ...Object.values(context.fixture.lessonIds),
  ])
  assert.equal(context.report.traceRedaction.forbiddenPatternMatches, 0)
  assert.deepEqual(context.report.runtime.consoleErrors, [])
  assert.deepEqual(context.report.runtime.pageErrors, [])
  assert.deepEqual(context.report.runtime.failedRequests, [])
}

export async function publishSuccessArtifacts(context, cleanupReceipt) {
  for (const name of buildPublishedArtifactNames()) {
    await rename(
      path.join(context.config.stagingDir, name),
      path.join(context.config.evidenceDir, name),
    )
  }
  await rm(context.config.stagingDir, { force: true, recursive: true })
  await writeJson(path.join(context.config.evidenceDir, "cleanup-receipt.json"), cleanupReceipt)
  await writeJson(
    path.join(context.config.evidenceDir, `cleanup-receipt-${context.config.runIdHash}.json`),
    cleanupReceipt,
  )
  const finalReport = { ...context.report, cleanupReceipt }
  await writeJson(
    path.join(context.config.evidenceDir, "public-gallery-browser-report.json"),
    finalReport,
  )
  await writeJson(
    path.join(
      context.config.evidenceDir,
      `public-gallery-browser-report-${context.config.runIdHash}.json`,
    ),
    finalReport,
  )
  context.progress("evidence-published")
}

export async function publishFailureArtifact(context, cleanupReceipt) {
  await writeJson(
    path.join(context.config.evidenceDir, `failed-run-${context.config.runIdHash}.json`),
    { ...context.report, cleanupReceipt },
  )
  await rm(context.config.stagingDir, { force: true, recursive: true })
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
