import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import path from "node:path"

import { verifyEvidenceFile } from "./records.mjs"

const finalWavePaths = Object.freeze({
  f1: ".omo/evidence/f1-supabase-auth-rls-e2e-plan-compliance.md",
  f2: ".omo/evidence/f2-supabase-auth-rls-e2e-review.md",
  f3: ".omo/evidence/f3-supabase-auth-rls-e2e-runtime-qa.md",
  f4: ".omo/evidence/f4-supabase-auth-rls-e2e-scope.md",
})

export async function verifyTargets(context, targets, remediation) {
  if (targets.length === 0) throw new Error("verify-evidence requires targets")
  for (const target of targets) {
    if (/^task-[1-8]$/.test(target)) await verifyTaskTarget(context, target, remediation)
    else if (/^f[1-4]$/.test(target)) await verifyFinalWaveTarget(context, target, remediation)
    else throw new Error(`Unknown evidence target: ${target}`)
  }
}

export async function verifyTaskTarget(context, target, remediation = new Map()) {
  const attempts = await discoverTaskAttemptPaths(context.repoRoot, target)
  assert.equal(attempts.length > 0, true, `${target} has no evidence attempts`)
  let latest
  for (const filePath of attempts) latest = await verifyEvidenceFile(context, filePath, remediation)
  assert.equal(latest.final.verdict, "APPROVE", `${target} latest attempt must APPROVE`)
}

export async function verifyFinalWaveTarget(context, target, remediation = new Map()) {
  const result = await verifyEvidenceFile(context, finalWavePathForTarget(target), remediation)
  assert.equal(result.final.verdict, "APPROVE", `${target} final verdict must APPROVE`)
}

export async function discoverTaskAttemptPaths(repoRoot, target) {
  const evidenceDir = path.join(repoRoot, ".omo/evidence")
  const files = await readdir(evidenceDir)
  const canonical = `${target}-supabase-auth-rls-e2e.log`
  const resumePattern = new RegExp(`^${target}-resume-(\\d+)-supabase-auth-rls-e2e\\.log$`)
  const resumes = files
    .map((fileName) => ({ fileName, match: fileName.match(resumePattern) }))
    .filter(({ match }) => match)
    .map(({ fileName, match }) => ({ fileName, index: Number(match[1]) }))
    .sort((left, right) => left.index - right.index)
  return [
    files.includes(canonical) ? `.omo/evidence/${canonical}` : null,
    ...resumes.map(({ fileName }) => `.omo/evidence/${fileName}`),
  ].filter(Boolean)
}

export function finalWavePathForTarget(target) {
  const filePath = finalWavePaths[target]
  if (!filePath) throw new Error(`Unknown final-wave target: ${target}`)
  return filePath
}
