import { readFile } from "node:fs/promises"

import { appendRedactedEvidence, writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import { diffSources, readCurrentManifest } from "../supabase-e2e/task8/source-manifest.mjs"
import { requireEvidenceRoot, resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { sha256 } from "./process.mjs"

const todo1OwnedPaths = Object.freeze([
  "SPOLINK_화면_설계.md",
  "package.json",
  "playwright.auth.config.ts",
  "tests/auth-ui-e2e/config-mode.mjs",
  "tests/auth-ui-e2e/contracts.mjs",
  "tests/auth-ui-e2e/evidence-paths.mjs",
  "tests/auth-ui-e2e/evidence.mjs",
  "tests/auth-ui-e2e/fake-lifecycle-harness.mjs",
  "tests/auth-ui-e2e/final-qa.spec.ts",
  "tests/auth-ui-e2e/harness.test.mjs",
  "tests/auth-ui-e2e/lifecycle.mjs",
  "tests/auth-ui-e2e/lifecycle-failures.test.mjs",
  "tests/auth-ui-e2e/ports.mjs",
  "tests/auth-ui-e2e/process.mjs",
  "tests/auth-ui-e2e/run-api-tests.mjs",
  "tests/auth-ui-e2e/run-final-qa.mjs",
  "tests/auth-ui-e2e/run-review-lanes.mjs",
  "tests/auth-ui-e2e/run.mjs",
  "tests/auth-ui-e2e/verify-plan-evidence.mjs",
  "tests/auth-ui-e2e/verify-source-fidelity.mjs",
  "tests/supabase-e2e/task8/evidence.mjs",
  "tests/supabase-e2e/task8/evidence-receipt.mjs",
  "tests/supabase-e2e/task8/orchestrator.mjs",
  "tests/supabase-e2e/task8/qa-proof.mjs",
])

export async function writeTodo1Summary({ checks, outputPath }) {
  await requireEvidenceRoot()
  const baseline = JSON.parse(
    await readFile(".omo/evidence/baseline-supabase-auth-ui-session.json", "utf8"),
  )
  const current = await readCurrentManifest()
  const sourceDelta = diffSources(baseline.sourceFiles, current.sourceFiles)
  const owned = new Set(todo1OwnedPaths)
  const summary = {
    schemaVersion: 1,
    todo: 1,
    filesAdded: sourceDelta.added
      .filter((item) => owned.has(item))
      .map((item) => currentFile(current, item)),
    filesModified: sourceDelta.modified
      .filter((item) => owned.has(item))
      .map((item) => modifiedFile(baseline, current, item)),
    filesDeleted: sourceDelta.deleted
      .filter((item) => owned.has(item))
      .map((item) => deletedFile(baseline, item)),
    dependencyDelta: dependencyDelta(baseline, current),
    checks: checks.slice().sort((left, right) => left.name.localeCompare(right.name)),
  }
  await writeRedactedJson(outputPath, summary, [])
  return { path: outputPath, sha256: sha256(await readFile(outputPath)) }
}

export async function appendTodo1Evidence({ exitCode, output }) {
  const evidencePath = await resolveEvidenceChildPath(
    ".omo/evidence/task-1-supabase-auth-ui-session.jsonl",
    { kind: "file", suffix: ".jsonl" },
  )
  await appendRedactedEvidence(
    evidencePath,
    {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      entryType: "final-verdict",
      command: "Todo 1 static harness verification",
      exitCode,
      redactedOutputPath: output.path,
      redactedOutputSha256: output.sha256,
      db: { notApplicable: true, reason: "Todo 1 static harness did not start Supabase" },
      http: { notApplicable: true, reason: "Playwright list did not drive HTTP scenarios" },
      cleanup: {
        command: "corepack pnpm supabase:assert-stopped",
        exitCode: 0,
        proofSha256: output.cleanupSha256,
      },
      verdict: exitCode === 0 ? "APPROVE" : "REJECT",
    },
    [],
  )
  return evidencePath
}

function currentFile(manifest, itemPath) {
  return {
    path: itemPath,
    sha256: manifest.sourceFiles.find((item) => item.path === itemPath).sha256,
  }
}

function modifiedFile(baseline, current, itemPath) {
  return {
    path: itemPath,
    beforeSha256: baseline.sourceFiles.find((item) => item.path === itemPath).sha256,
    afterSha256: current.sourceFiles.find((item) => item.path === itemPath).sha256,
  }
}

function deletedFile(baseline, itemPath) {
  return {
    path: itemPath,
    beforeSha256: baseline.sourceFiles.find((item) => item.path === itemPath).sha256,
  }
}

function dependencyDelta(baseline, current) {
  return {
    production: diffDependencies(baseline.productionDependencies, current.productionDependencies),
    development: diffDependencies(
      baseline.developmentDependencies,
      current.developmentDependencies,
    ),
  }
}

function diffDependencies(before, after) {
  const base = new Map(before.map((item) => [item.name, item.version]))
  const next = new Map(after.map((item) => [item.name, item.version]))
  return {
    added: [...next]
      .filter(([name]) => !base.has(name))
      .map(([name, version]) => ({ name, version })),
    removed: [...base]
      .filter(([name]) => !next.has(name))
      .map(([name, version]) => ({ name, version })),
    changed: [...next]
      .filter(([name, version]) => base.has(name) && base.get(name) !== version)
      .map(([name, to]) => ({ name, from: base.get(name), to })),
  }
}
