import { createHash } from "node:crypto"

export async function prepareSupabaseRuntime({
  publishOwnedRuntime = () => {},
  readStatus,
  reset,
  start,
}) {
  try {
    const status = await readStatus()
    return runtime("reused", status)
  } catch (error) {
    if (error?.code !== "supabase_not_running") throw error
  }

  await start()
  const ownedRuntime = runtime("owned", null)
  publishOwnedRuntime(ownedRuntime)
  await reset()
  ownedRuntime.status = await readStatus()
  ownedRuntime.bindingSha256 = runtimeBinding(ownedRuntime.status)
  return ownedRuntime
}

export function cleanupSupabaseRuntime(runtimeState, dependencies) {
  const cleanup = runtimeState.cleanup
  if (cleanup.state === "completed") return Promise.resolve(cleanup.result)
  if (cleanup.state === "in-progress") return cleanup.inFlight

  cleanup.state = "in-progress"
  const execution = performSupabaseCleanup(runtimeState, dependencies)
  cleanup.inFlight = execution.then(
    (result) => {
      cleanup.result = result
      cleanup.state = "completed"
      return result
    },
    (error) => {
      cleanup.state = "pending"
      throw error
    },
  )
  return cleanup.inFlight.finally(() => {
    cleanup.inFlight = null
  })
}

export function createCleanupCoordinator(runCleanup) {
  let inFlight = null
  let result = null
  let state = "pending"
  return {
    get state() {
      return state
    },
    run() {
      if (state === "completed") return Promise.resolve(result)
      if (state === "in-progress") return inFlight
      state = "in-progress"
      inFlight = Promise.resolve()
        .then(runCleanup)
        .then(
          (value) => {
            result = value
            state = "completed"
            return value
          },
          (error) => {
            state = "pending"
            throw error
          },
        )
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
  }
}

export function createSignalCleanupHandler({ cleanup, exit, recordError }) {
  return async function handleSignal(signal) {
    try {
      await cleanup()
      exit(signal === "SIGINT" ? 130 : 143)
    } catch (error) {
      recordError(error)
    }
  }
}

async function performSupabaseCleanup(
  runtimeState,
  { assertStopped, commitOwnedProof, readStatus, stop, writePreservedReceipt },
) {
  if (runtimeState.mode === "owned") {
    if (!runtimeState.cleanup.stopCompleted) {
      await stop()
      runtimeState.cleanup.stopCompleted = true
    }
    if (!runtimeState.cleanup.assertCompleted) {
      await assertStopped()
      runtimeState.cleanup.assertCompleted = true
    }
    await commitOwnedProof()
    return { kind: "stopped" }
  }

  const bindingSha256 = runtimeBinding(await readStatus())
  if (bindingSha256 !== runtimeState.bindingSha256) {
    throw new Error("Reused guarded Supabase runtime identity changed")
  }
  const receipt = { bindingSha256, status: "preserved" }
  await writePreservedReceipt(receipt)
  return { kind: "preserved", receipt }
}

function runtime(mode, status) {
  return {
    bindingSha256: status ? runtimeBinding(status) : null,
    cleanup: {
      assertCompleted: false,
      inFlight: null,
      result: null,
      state: "pending",
      stopCompleted: false,
    },
    mode,
    status,
  }
}

function runtimeBinding(status) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        anonKey: status.anonKey,
        apiUrl: status.apiUrl,
        dbUrl: status.dbUrl,
        serviceRoleKey: status.serviceRoleKey,
      }),
    )
    .digest("hex")
}
