import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { writeTimestampReport } from "./evidence-provenance.mjs"
import { assertPreservedOwnership, readOwnershipState } from "./ownership-state.mjs"
import { buildManifest, verifyRun } from "./run-report.mjs"
import { captureSourceBinding, compareSourceBindings } from "./source-binding.mjs"
import { publishCanonicalArtifacts } from "./visual-publication.mjs"

export async function runTask10BrowserQa(context) {
  context.sourceBinding = await captureSourceBinding(context.repoRoot)
  const initial = await readOwnershipState()
  await mkdir(context.evidenceDir, { mode: 0o700, recursive: true })
  await context.writePrivateJson("source-binding.json", context.sourceBinding)
  await context.writePrivateJson("initial-ownership.json", initial)

  for (const runNumber of [1, 2]) await runCanonicalPass(context, runNumber)

  await publishCanonicalArtifacts(context.evidenceDir)
  const finalSourceBinding = await captureSourceBinding(context.repoRoot)
  const sourceDrift = compareSourceBindings(context.sourceBinding, finalSourceBinding)
  assert.equal(sourceDrift.driftCount, 0, "source binding drifted during canonical runs")
  await context.writePrivateJson("source-binding-final.json", finalSourceBinding)
  await context.writePrivateJson("source-drift.json", sourceDrift)
  const final = await readOwnershipState()
  assertPreservedOwnership(initial, final)
  const manifest = await buildManifest(context, initial, final)
  await context.writePrivateJson("response-status-manifest.json", manifest)
  await context.writePrivateJson("cleanup-receipt.json", {
    allFixtureCountsZero: manifest.runs.every((run) => run.cleanupAllZero),
    interrupted: context.processRunner.interrupted(),
    ownedPort3268Free: final.port3268Free,
    preexistingNextPreserved: final.port3000Pid === initial.port3000Pid,
    preexistingSupabasePreserved: final.supabaseApiStatus === 200,
    temporaryDirectoriesRemoved: manifest.runs.every((run) => run.publicTempRemoved),
  })
  await writeTimestampReport(context)
}

async function runCanonicalPass(context, runNumber) {
  const runDir = path.join(context.evidenceDir, `run-${runNumber}`)
  const authoringDir = path.join(runDir, "authoring")
  const publicDir = path.join(runDir, "public")
  await mkdir(authoringDir, { mode: 0o700, recursive: true })
  await mkdir(publicDir, { mode: 0o700, recursive: true })
  await context.processRunner.runBounded({
    command: [process.execPath, "tests/lesson-images/authoring-browser-qa.mjs", authoringDir],
    label: `authoring-run-${runNumber}`,
    timeoutMs: 210_000,
  })
  await context.processRunner.runBounded({
    command: [process.execPath, "tests/lesson-images/public-gallery-browser-qa.mjs"],
    env: { PUBLIC_GALLERY_EVIDENCE_DIR: publicDir },
    label: `public-run-${runNumber}`,
    timeoutMs: 140_000,
  })
  await verifyRun(runDir)
}
