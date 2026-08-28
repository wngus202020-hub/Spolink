import path from "node:path"

import { writeJsonMode600 } from "../../auth-ui-e2e/process.mjs"
import { computeTask3SourceBinding } from "../../high-priority-missing-services/task3-evidence.mjs"

export async function writeTask5DbRaceReceipt({
  attemptRoot,
  boundaries,
  cleanup,
  observations,
  races,
  repoRoot,
}) {
  if (!attemptRoot) return null
  const expectedRaces = 7
  const passed =
    observations.length === 2 &&
    observations.every((entry) => entry.status === "passed") &&
    boundaries.length >= 8 &&
    boundaries.every((entry) => entry.mutated === false) &&
    races.length === expectedRaces &&
    races.every((entry) => entry.pendingWorkers === 0) &&
    cleanup.includes("observer-and-barrier-closed") &&
    cleanup.includes("fixture-graph-removed")
  const outputPath = path.join(attemptRoot, "task-5-db-races.json")
  await writeJsonMode600(
    outputPath,
    {
      boundaries,
      cleanup,
      command: "node --test tests/supabase-e2e/reservation-lifecycle.test.mjs",
      expectedRaceCount: expectedRaces,
      races,
      recordType: "task-5-db-race-receipt",
      schemaVersion: 1,
      source: await computeTask3SourceBinding(repoRoot),
      verdict: passed ? "passed" : "failed",
    },
    { repoRoot },
  )
  return outputPath
}
