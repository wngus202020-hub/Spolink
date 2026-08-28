import { readFile } from "node:fs/promises"
import {
  resolveSupabaseEvidenceLog,
  resolveSupabaseOutputDir,
} from "../../auth-ui-e2e/evidence-paths.mjs"
import { appendRedactedEvidence } from "../evidence-redaction.mjs"
import { sha256, writeRedactedOutput } from "./process.mjs"

export async function appendTodo8RunEvidence({
  cleanupCommand,
  cleanupProofPath,
  evidenceLog,
  exitCode,
  outputDir,
  qaSuccess,
  summaryPath,
}) {
  const resolvedOutputDir = outputDir ?? (await resolveSupabaseOutputDir())
  const summary = await readFile(summaryPath)
  const outputSha = sha256(summary)
  const resolvedCleanupPath = cleanupProofPath ?? `${resolvedOutputDir}/assert-stopped.json`
  const cleanupSha = sha256(await readFile(resolvedCleanupPath))
  const db = qaSuccess?.summary.db.cancelled ?? {
    notApplicable: true,
    reason: "run exited before durable Todo8 QA database proof completed",
  }
  const http = qaSuccess
    ? {
        bodySha256: qaSuccess.summary.authenticatedCancellation.bodySha256,
        status: qaSuccess.summary.authenticatedCancellation.status,
      }
    : {
        notApplicable: true,
        reason: "run exited before durable Todo8 QA HTTP proof completed",
      }
  await appendRedactedEvidence(
    evidenceLog ?? (await resolveSupabaseEvidenceLog()),
    {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      entryType: "final-verdict",
      command: "corepack pnpm test:e2e:supabase",
      exitCode,
      redactedOutputPath: summaryPath,
      redactedOutputSha256: outputSha,
      db,
      http,
      cleanup: {
        command:
          cleanupCommand ?? "corepack pnpm supabase:stop && corepack pnpm supabase:assert-stopped",
        exitCode: 0,
        proofSha256: cleanupSha,
      },
      verdict: exitCode === 0 ? "APPROVE" : "REJECT",
    },
    [],
  )
}

export async function writeTodo8Summary(context, status, error, summaryPath) {
  await writeRedactedOutput(summaryPath, {
    before3002: context.before3002,
    cleanupState: context.cleanupCoordinator?.state ?? null,
    cleanupError: context.cleanupError instanceof Error ? context.cleanupError.message : null,
    error: error instanceof Error ? error.message : null,
    qaSuccessPath: context.qaSuccess?.path ?? null,
    signalCleanupFailed: context.signalCleanupError instanceof Error,
    supabaseCleanup: context.supabaseRuntime
      ? {
          assertCompleted: context.supabaseRuntime.cleanup.assertCompleted,
          state: context.supabaseRuntime.cleanup.state,
          stopCompleted: context.supabaseRuntime.cleanup.stopCompleted,
        }
      : null,
    supabaseRuntimeMode: context.supabaseRuntime?.mode ?? null,
    selectedNextPorts: [context.unconfigured?.port, context.configured?.port].filter(Boolean),
    status,
  })
}
