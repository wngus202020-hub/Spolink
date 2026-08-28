import { randomUUID } from "node:crypto"
import process from "node:process"

import {
  LocalSupabaseNotRunningError,
  readGuardedLocalStatus,
} from "../scripts/supabase-local/local-status.mjs"
import { requireCurrentRuntimeReceipt, runStart, runStop } from "../scripts/supabase-local.mjs"

export async function acquireMoneyOperationsRuntime({
  readStatus = readGuardedLocalStatus,
  readReceipt = () => requireCurrentRuntimeReceipt({}),
  start = runStart,
  stop = runStop,
  createRunId = () => `spolink-money-${randomUUID().replaceAll("-", "")}`,
  signalTarget = process,
  reportCleanupFailure = (error) =>
    console.error("Money runtime cleanup failed; guarded residue may remain", error),
} = {}) {
  try {
    const status = await readStatus()
    const receipt = await readReceipt()
    return {
      ownership: "reused",
      receipt,
      release: async () => {},
      status,
    }
  } catch (error) {
    if (!(error instanceof LocalSupabaseNotRunningError)) throw error
  }

  const runId = createRunId()
  const started = await start({ runId })
  if (started.runId !== runId) {
    throw new Error("Fresh money runtime ownership is ambiguous")
  }
  const identity = {
    dockerOwnership: started.dockerOwnership,
    runId: started.runId,
  }
  let releasePromise
  let finishSignalCleanup
  const signalCleanup = new Promise((resolve) => {
    finishSignalCleanup = resolve
  })
  const release = () => {
    signalTarget.off("SIGINT", handleSigint)
    releasePromise ??= stop(identity)
    return releasePromise
  }
  const handleSigint = () => {
    void release()
      .catch(reportCleanupFailure)
      .finally(() => {
        signalTarget.kill(signalTarget.pid, "SIGINT")
        finishSignalCleanup()
      })
  }
  signalTarget.once("SIGINT", handleSigint)

  try {
    return {
      ownership: "owned",
      release,
      signalCleanup,
      status: await readStatus(),
    }
  } catch (primaryError) {
    try {
      await release()
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        "Money runtime cleanup failed; guarded residue may remain",
      )
    }
    throw primaryError
  }
}
