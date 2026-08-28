import assert from "node:assert/strict"

import { capacityAndConcurrency } from "./live/capacity-concurrency.mjs"
import { cleanupAndRetryMatrix } from "./live/cleanup-retry.mjs"
import { createLessonImageLiveLifecycle } from "./live/context.mjs"
import { safeErrorCode, safeErrorFingerprint, writeSummary } from "./live/evidence.mjs"
import { formatBoundaryAndCompensation } from "./live/format-compensation.mjs"
import { directRlsMatrix, idempotencyMatrix } from "./live/idempotency-rls.mjs"
import { orderingAndPublicRead } from "./live/ordering-public-read.mjs"
import { manualProviderQa } from "./live/provider-qa.mjs"
import { mutationAuthorizationMatrix, roleAndBoundaryMatrix } from "./live/role-state-checks.mjs"
import { serializationMatrix } from "./live/serialization-races.mjs"
import { captureSplitLessonImageSourceBinding } from "./live/source-binding.mjs"

const phases = [
  roleAndBoundaryMatrix,
  mutationAuthorizationMatrix,
  formatBoundaryAndCompensation,
  capacityAndConcurrency,
  orderingAndPublicRead,
  serializationMatrix,
  cleanupAndRetryMatrix,
  idempotencyMatrix,
  directRlsMatrix,
  manualProviderQa,
]

export async function runLessonImageLiveScenario() {
  const blockers = []
  const observations = []
  const lifecycle = createLessonImageLiveLifecycle(blockers, observations)
  let cleanup = null
  let currentPhase = "startup"
  let sourceBinding = null

  try {
    sourceBinding = await captureSplitLessonImageSourceBinding()
    const context = await lifecycle.start()
    for (const phase of phases) {
      currentPhase = phase.name
      await phase(context)
    }
  } catch (error) {
    blockers.push({
      actual: "scenario_error",
      code: safeErrorCode(error),
      criterion: `live_phase_${currentPhase}`,
      errorSha256: safeErrorFingerprint(error),
      expected: "all_nonblocked_phases_complete",
    })
  } finally {
    cleanup = await lifecycle.cleanup()
  }

  const finalSourceBinding = await captureSplitLessonImageSourceBinding()
  if (sourceBinding?.aggregateSha256 !== finalSourceBinding.aggregateSha256) {
    blockers.push({
      actual: finalSourceBinding.aggregateSha256,
      criterion: "focused_source_binding_stability",
      expected: sourceBinding?.aggregateSha256 ?? "captured_start_binding",
    })
  }

  await writeSummary({
    blockers,
    cleanup,
    observations,
    proxyObservations: lifecycle.proxyObservations,
    sourceBinding: sourceBinding ?? finalSourceBinding,
  })
  assert.equal(blockers.length, 0, `Todo 9 live blockers: ${JSON.stringify(blockers)}`)
}
