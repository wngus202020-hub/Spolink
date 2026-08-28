import { capturePort3002 } from "../supabase-e2e/next-server.mjs"
import { cleanupRunnerCreatedSupabaseCliTemp } from "./mypage-profile-edit-runtime-cleanup.mjs"
import { runBuffered, stopActiveCommand, stopChild, writeJsonMode600 } from "./process.mjs"

const observerSettlementTimeoutMs = 10_000

export async function cleanupApiLifecycle(context, repoRoot, failure) {
  const cleanupErrors = []
  const cleanup = {
    authUser: "not-tracked",
    browser: "not-tracked",
    config: "not-tracked",
    mailpitMessages: [],
    next: "not-tracked",
    profile: "not-tracked",
    reservation: context.released ? "already-released" : "not-released",
    supabase: "not-stopped",
    supabaseCliTemp: { verdict: "not-cleaned" },
    tempPaths: [],
  }
  const browserErrorCount = cleanupErrors.length
  await captureCleanupError(cleanupErrors, async () => {
    await stopActiveCommand(context.browserCommand)
    context.browserCommand = null
  })
  for (const close of context.browserContexts) await captureCleanupError(cleanupErrors, close)
  if (context.browserOwned || context.browserContexts.length > 0) {
    cleanup.browser = cleanupErrors.length === browserErrorCount ? "stopped" : "failed"
    context.shutdownOrder.push("browser")
  }
  await settleObservers(context, cleanupErrors)
  await captureCleanupError(cleanupErrors, async () => {
    await stopActiveCommand(context.activeCommand)
    context.activeCommand = null
  })
  if (!context.released) {
    try {
      await context.reservation.release()
      context.released = true
      cleanup.reservation = "released"
    } catch (error) {
      cleanup.reservation = "failed"
      cleanupErrors.push(error)
    }
  }
  await cleanupExactTargets(context, cleanup, cleanupErrors)
  await cleanupNext(context, cleanup, cleanupErrors, repoRoot)
  const runtime = await cleanupSupabase(context, cleanup, repoRoot)
  if (runtime.error) cleanupErrors.push(runtime.error)
  const after3002 = await capturePort3002()
  if (context.authWorkspace) {
    try {
      await context.authWorkspace.assertRepositoryConfigUnchanged()
      await context.authWorkspace.cleanup()
      cleanup.config = "external-removed"
      context.authWorkspace = null
    } catch (error) {
      cleanup.config = "failed"
      cleanupErrors.push(error)
    }
  }
  try {
    cleanup.supabaseCliTemp = await cleanupRunnerCreatedSupabaseCliTemp(
      context.supabaseTempSnapshot,
    )
    if (cleanup.supabaseCliTemp.verdict !== "APPROVE") {
      cleanupErrors.push(new Error("Supabase CLI temp cleanup ownership is ambiguous"))
    }
  } catch (error) {
    cleanup.supabaseCliTemp = { verdict: "REJECT" }
    cleanupErrors.push(error)
  }
  const message = describeCleanupFailure({
    after3002,
    before3002: context.before3002,
    cleanupErrors,
    stopped: runtime.stopped,
    stop: runtime.stop,
  })
  if (context.cleanupReceiptPath) {
    await writeJsonMode600(
      context.cleanupReceiptPath,
      {
        cleanup,
        mode: context.manifest.mode,
        runId: context.manifest.runId,
        shutdownOrder: context.shutdownOrder,
        stoppedAsserted: runtime.stopped.exitCode === 0,
        verdict: message ? "REJECT" : "APPROVE",
      },
      { repoRoot },
    )
  }
  if (message) {
    if (failure instanceof Error) throw new Error(`${failure.message}\n${message}`)
    throw new Error(message)
  }
}

async function settleObservers(context, errors) {
  await captureCleanupError(errors, async () => {
    await withDeadline(
      Promise.allSettled(context.observers).then((results) => {
        const rejected = results.find((result) => result.status === "rejected")
        if (rejected) throw rejected.reason
      }),
      observerSettlementTimeoutMs,
    )
  })
}

async function cleanupNext(context, cleanup, errors, repoRoot) {
  if (context.nextChild) {
    try {
      await stopChild(context.nextChild, context.reservation.port)
      cleanup.next = "stopped"
    } catch (error) {
      cleanup.next = "failed"
      errors.push(error)
    }
    context.shutdownOrder.push("next")
  }
  if (!context.nextOutputCapture) return
  try {
    const summary = await context.nextOutputCapture.settle()
    if (context.nextServerSummaryPath) {
      await writeJsonMode600(
        context.nextServerSummaryPath,
        { schemaVersion: 1, ...summary },
        { repoRoot },
      )
    }
    await context.nextOutputCapture.cleanup()
    context.nextOutputCapture = null
  } catch (error) {
    errors.push(error)
  }
}

async function cleanupSupabase(context, cleanup, repoRoot) {
  let stop = { exitCode: 0, stderr: "" }
  const supabaseRoot = context.authWorkspace?.root ?? repoRoot
  if (context.supabaseOwned) {
    stop = await runBuffered("corepack", ["pnpm", "supabase:stop"], { cwd: supabaseRoot })
    context.shutdownOrder.push("supabase")
    cleanup.supabase = stop.exitCode === 0 ? "stopped" : "failed"
  } else {
    cleanup.supabase = "not-owned"
  }
  const stopped = await runBuffered("corepack", ["pnpm", "supabase:assert-stopped"], {
    cwd: supabaseRoot,
  })
  return { error: null, stop, stopped }
}

async function cleanupExactTargets(context, cleanup, errors) {
  const { manifest } = context
  if (manifest.profileId !== null) {
    cleanup.profile = await cleanupExact(
      manifest.profileId,
      context.cleanupTargets.verifyAndDeleteProfile,
      "profile",
      errors,
    )
  }
  if (manifest.authUserId !== null) {
    cleanup.authUser = await cleanupExact(
      manifest.authUserId,
      context.cleanupTargets.deleteAuthUser,
      "Auth user",
      errors,
    )
  }
  for (const id of manifest.mailpitMessageIds) {
    cleanup.mailpitMessages.push(
      await cleanupExact(
        id,
        context.cleanupTargets.deleteMailpitMessage,
        "Mailpit message",
        errors,
      ),
    )
  }
}

async function cleanupExact(id, operation, label, errors) {
  if (typeof operation !== "function") {
    errors.push(new Error(`${label} cleanup is not configured for an owned exact target`))
    return "failed"
  }
  try {
    await operation(id)
    return "deleted"
  } catch (error) {
    errors.push(error)
    return "failed"
  }
}

async function captureCleanupError(errors, operation) {
  try {
    await operation()
  } catch (error) {
    errors.push(error)
  }
}

export function describeCleanupFailure({ after3002, before3002, cleanupErrors, stopped, stop }) {
  const messages = cleanupErrors.map((error) =>
    error instanceof Error ? error.message : String(error),
  )
  if (stop.exitCode !== 0) messages.push(`corepack pnpm supabase:stop failed\n${stop.stderr}`)
  if (stopped.exitCode !== 0) {
    messages.push(`corepack pnpm supabase:assert-stopped failed\n${stopped.stderr}`)
  }
  if (after3002 !== before3002) messages.push("Port 3002 listener changed during auth lifecycle")
  return messages.length > 0 ? `Auth lifecycle cleanup failed: ${messages.join("\n")}` : null
}

async function withDeadline(promise, ms) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Auth lifecycle cleanup exceeded ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}
