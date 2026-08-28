#!/usr/bin/env node
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"

const expectedObservationLabels = new Set([
  "spoof_metadata_magic_byte_boundary",
  "valid_image/jpeg",
  "valid_image/png",
  "valid_image/webp",
])
const expectedCleanupKeys = ["authUsers", "images", "intents", "lessons", "objects"]

export async function runLessonImageRpcBoundarySecurityCli(runScenario) {
  const result = await runScenario()
  assertSemanticSuccess(result)
  process.stdout.write(
    `LESSON_IMAGE_RPC_BOUNDARY_SECURITY_OK observations=${result.observations.length}\n`,
  )
}

function assertSemanticSuccess(result) {
  const observations = Array.isArray(result?.observations) ? result.observations : []
  const labels = new Set(observations.map((observation) => observation?.label))
  const cleanup = result?.cleanup
  const complete =
    observations.length === expectedObservationLabels.size &&
    labels.size === expectedObservationLabels.size &&
    [...expectedObservationLabels].every((label) => labels.has(label)) &&
    cleanup !== null &&
    typeof cleanup === "object" &&
    expectedCleanupKeys.every((key) => cleanup[key] === 0)

  assert.equal(
    complete,
    true,
    "RPC boundary security CLI expected semantic observations and cleanup",
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { runLessonImageRpcBoundarySecurityScenario } = await import("../rpc-boundary-security.mjs")
  await runLessonImageRpcBoundarySecurityCli(runLessonImageRpcBoundarySecurityScenario)
}
