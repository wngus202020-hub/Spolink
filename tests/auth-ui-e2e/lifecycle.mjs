import { spawn } from "node:child_process"
import { chmod, lstat, open, rm, writeFile } from "node:fs/promises"

import { readGuardedLocalStatus } from "../supabase-e2e/local-status.mjs"
import { capturePort3002 } from "../supabase-e2e/next-server.mjs"
import {
  applyAuthConfigMode,
  assertNoExternalTestBaseUrl,
  restoreConfigSnapshot,
} from "./config-mode.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { reserveLoopbackPort } from "./ports.mjs"
import {
  buildChildEnv,
  runBuffered,
  stopActiveCommand,
  stopChild,
  trackActiveCommand,
  writeJsonMode600,
} from "./process.mjs"

const observerSettlementTimeoutMs = 10_000

export function createRunManifest({
  configSnapshotHash = null,
  evidencePaths = [],
  mode,
  runId,
  tempPaths = [],
}) {
  if (typeof runId !== "string" || runId.length === 0) throw new Error("runId is required")
  if (typeof mode !== "string" || mode.length === 0) throw new Error("mode is required")
  return {
    runId,
    mode,
    authUserId: null,
    profileId: null,
    mailpitMessageIds: [],
    configSnapshotHash,
    ownedPids: [],
    tempPaths: [...tempPaths],
    evidencePaths: [...evidencePaths],
  }
}

export function buildApiTestEnv(parentEnv, baseUrl, status) {
  const env = buildChildEnv(parentEnv, {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NODE_ENV: "test",
    SPOLINK_TEST_BASE_URL: baseUrl,
  })
  return env
}

export async function runApiTestLifecycle({ repoRoot = process.cwd() } = {}) {
  assertNoExternalTestBaseUrl()
  const reservation = await reserveLoopbackPort()
  const context = await createLifecycleContext(reservation, { mode: "api" })
  installSignals(context)
  let failure = null
  try {
    await runRequired(context, "corepack", ["pnpm", "supabase:start"], repoRoot)
    context.supabaseOwned = true
    await runRequired(context, "corepack", ["pnpm", "supabase:reset"], repoRoot)
    const status = await readGuardedLocalStatus({ repoRoot })
    await reservation.release()
    context.released = true
    context.nextChild = startNextChild(repoRoot, reservation.port, status, false)
    trackOwnedPid(context, context.nextChild.pid)
    await waitForConfiguredState(reservation.baseUrl)
    const result = await runBuffered("corepack", ["pnpm", "test:api:contracts"], {
      cwd: repoRoot,
      env: buildApiTestEnv(process.env, reservation.baseUrl, status),
    })
    if (result.exitCode !== 0)
      throw new Error(`corepack pnpm test:api:contracts failed\n${result.stderr}`)
    return { baseUrl: reservation.baseUrl, exitCode: result.exitCode, port: reservation.port }
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await cleanupOnce(context, repoRoot, failure)
    } finally {
      uninstallSignals(context)
    }
  }
}

export async function withConfiguredAuthMode(options, callback) {
  assertNoExternalTestBaseUrl()
  const reservation = await reserveLoopbackPort()
  const repoRoot = options.repoRoot ?? process.cwd()
  const context = await createLifecycleContext(reservation, {
    ...options,
    mode: options.enableConfirmations ? "confirmation-on" : "confirmation-off",
  })
  installSignals(context, repoRoot)
  let failure = null
  try {
    const { snapshot } = await applyAuthConfigMode({
      baseUrl: reservation.baseUrl,
      enableConfirmations: options.enableConfirmations,
      ...(options.configPath ? { filePath: options.configPath } : {}),
    })
    context.configSnapshot = snapshot
    context.manifest.configSnapshotHash = snapshot.sha256
    injectAuthFailure("after-config")
    await runRequired(context, "corepack", ["pnpm", "supabase:start"], repoRoot)
    context.supabaseOwned = true
    await runRequired(context, "corepack", ["pnpm", "supabase:reset"], repoRoot)
    const status = await readGuardedLocalStatus({ repoRoot })
    await reservation.release()
    context.released = true
    context.nextChild = startNextChild(
      repoRoot,
      reservation.port,
      status,
      options.enableCoachUiFixtures === true,
    )
    trackOwnedPid(context, context.nextChild.pid)
    await waitForConfiguredState(reservation.baseUrl)
    context.nextReady = true
    injectAuthFailure("after-next-ready")
    return await callback({
      baseUrl: reservation.baseUrl,
      lifecycle: createLifecycleControl(context, repoRoot),
      port: reservation.port,
      status,
    })
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      await cleanupOnce(context, repoRoot, failure)
    } finally {
      uninstallSignals(context)
    }
  }
}

async function cleanupApiLifecycle(context, repoRoot, failure) {
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
    tempPaths: [],
  }
  const browserErrorCount = cleanupErrors.length
  await captureCleanupError(cleanupErrors, async () => {
    await stopActiveCommand(context.browserCommand)
    context.browserCommand = null
  })
  for (const close of context.browserContexts) {
    await captureCleanupError(cleanupErrors, close)
  }
  if (context.browserOwned || context.browserContexts.length > 0) {
    cleanup.browser = cleanupErrors.length === browserErrorCount ? "stopped" : "failed"
    context.shutdownOrder.push("browser")
  }
  await captureCleanupError(cleanupErrors, async () => {
    await withDeadline(
      Promise.allSettled(context.observers).then((results) => {
        const rejected = results.find((result) => result.status === "rejected")
        if (rejected) throw rejected.reason
      }),
      observerSettlementTimeoutMs,
    )
  })
  try {
    await stopActiveCommand(context.activeCommand)
    context.activeCommand = null
  } catch (error) {
    cleanupErrors.push(error)
  }
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
  if (context.configSnapshot) {
    try {
      const restored = await restoreConfigSnapshot(context.configSnapshot)
      cleanup.config =
        restored.sha256 === context.manifest.configSnapshotHash ? "restored" : "hash-mismatch"
      context.configSnapshot = null
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (context.nextChild) {
    try {
      await stopChild(context.nextChild, context.reservation.port)
      cleanup.next = "stopped"
    } catch (error) {
      cleanup.next = "failed"
      cleanupErrors.push(error)
    }
    context.shutdownOrder.push("next")
  }
  let stop = { exitCode: 0, stderr: "" }
  if (context.supabaseOwned) {
    stop = await runBuffered("corepack", ["pnpm", "supabase:stop"], { cwd: repoRoot })
    context.shutdownOrder.push("supabase")
    cleanup.supabase = stop.exitCode === 0 ? "stopped" : "failed"
  } else {
    cleanup.supabase = "not-owned"
  }
  const stopped = await runBuffered("corepack", ["pnpm", "supabase:assert-stopped"], {
    cwd: repoRoot,
  })
  const after3002 = await capturePort3002()
  const message = describeCleanupFailure({
    after3002,
    before3002: context.before3002,
    cleanupErrors,
    stopped,
    stop,
  })
  if (context.cleanupReceiptPath) {
    await writeJsonMode600(
      context.cleanupReceiptPath,
      {
        cleanup,
        mode: context.manifest.mode,
        runId: context.manifest.runId,
        shutdownOrder: context.shutdownOrder,
        stoppedAsserted: stopped.exitCode === 0,
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

async function createLifecycleContext(reservation, options = {}) {
  const runId = options.runId ?? `auth-${Date.now().toString(36)}-${process.pid}`
  const repoRoot = options.repoRoot ?? process.cwd()
  const cleanupReceiptPath = await resolveCleanupReceiptPath(options.cleanupReceiptPath, repoRoot)
  return {
    activeCommand: null,
    before3002: await capturePort3002(),
    browserCommand: null,
    browserContexts: [],
    browserOwned: false,
    cleanupPromise: null,
    cleanupReceiptPath,
    cleanupTargets: options.cleanupTargets ?? {},
    configSnapshot: null,
    manifest: createRunManifest({
      evidencePaths: options.evidencePaths ?? [],
      mode: options.mode ?? "unknown",
      runId,
      tempPaths: options.tempPaths ?? [],
    }),
    nextReady: false,
    nextChild: null,
    observers: [],
    readyPromise: null,
    released: false,
    reservation,
    shutdownOrder: [],
    signalExitPromise: null,
    signalHandlers: [],
    supabaseOwned: false,
  }
}

export async function resolveCleanupReceiptPath(inputPath, repoRoot = process.cwd()) {
  if (!inputPath) return null
  return resolveEvidenceChildPath(inputPath, {
    kind: "file",
    repoRoot,
    suffix: ".json",
  })
}

function createLifecycleControl(context, repoRoot) {
  return {
    addMailpitMessageId(id) {
      addExactValue(context.manifest.mailpitMessageIds, id, "Mailpit message ID")
    },
    get manifest() {
      return context.manifest
    },
    get ready() {
      return context.readyPromise ?? Promise.reject(new Error("Browser child is not tracked"))
    },
    reachFailurePoint: injectAuthFailure,
    runBrowserChild(command, args, options = {}) {
      if (context.browserCommand) throw new Error("Browser child is already tracked")
      let active = null
      const result = runBuffered(command, args, {
        ...options,
        cwd: options.cwd ?? repoRoot,
        onChild: (child) => {
          active = trackActiveCommand(child)
          context.browserCommand = active
          context.browserOwned = true
          trackOwnedPid(context, child.pid)
          context.readyPromise = writeReadyMarker(context)
          options.onChild?.(child)
        },
      })
      return Promise.all([context.readyPromise, result]).then(([, childResult]) => {
        if (context.browserCommand === active) context.browserCommand = null
        return childResult
      })
    },
    setIdentity({ authUserId, mailpitMessageIds = [], profileId }) {
      setExactIdentity(context.manifest, "authUserId", authUserId)
      setExactIdentity(context.manifest, "profileId", profileId)
      for (const id of mailpitMessageIds) {
        addExactValue(context.manifest.mailpitMessageIds, id, "Mailpit message ID")
      }
    },
    trackBrowserContext(close) {
      if (typeof close !== "function") throw new Error("Browser context closer must be a function")
      if (!context.browserContexts.includes(close)) context.browserContexts.push(close)
    },
    trackObserver(observer) {
      const tracked = Promise.resolve(observer)
      context.observers.push(tracked)
      return tracked
    },
  }
}

function cleanupOnce(context, repoRoot, failure) {
  if (!context.cleanupPromise) {
    context.cleanupPromise = cleanupApiLifecycle(context, repoRoot, failure)
  }
  return context.cleanupPromise
}

function startNextChild(repoRoot, port, status, enableCoachUiFixtures) {
  return spawn(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      env: buildChildEnv(process.env, {
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
        ...(process.env["SPOLINK_VISUAL_QA_DIR"]
          ? { NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX: "1" }
          : {}),
        ...(enableCoachUiFixtures ? { SPOLINK_COACH_UI_FIXTURES: "enabled" } : {}),
        SPOLINK_AUTH_FLOW_SECRET: Buffer.alloc(32, 7).toString("base64url"),
      }),
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    },
  )
}

async function waitForConfiguredState(baseUrl) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config/supabase`)
      if (response.ok) {
        const body = await response.json()
        if (body.configured === true) return
      }
    } catch {
      // Retry until the bounded readiness deadline.
    }
    await delay(250)
  }
  throw new Error("Configured Next readiness timed out")
}

async function runRequired(context, command, args, cwd) {
  let activeCommand = null
  const result = await runBuffered(command, args, {
    cwd,
    onChild: (child) => {
      activeCommand = trackActiveCommand(child)
      context.activeCommand = activeCommand
      trackOwnedPid(context, child.pid)
    },
  })
  if (context.activeCommand === activeCommand) context.activeCommand = null
  if (context.shuttingDown) await new Promise(() => {})
  if (result.exitCode !== 0)
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr}`)
  return result
}

function injectAuthFailure(point) {
  if (process.env.SPOLINK_AUTH_E2E_INJECT_FAILURE === point) {
    throw new Error(`Injected auth E2E failure: ${point}`)
  }
}

async function cleanupExactTargets(context, cleanup, cleanupErrors) {
  const { manifest } = context
  if (manifest.profileId !== null) {
    cleanup.profile = await cleanupExact(
      manifest.profileId,
      context.cleanupTargets.verifyAndDeleteProfile,
      "profile",
      cleanupErrors,
    )
  }
  if (manifest.authUserId !== null) {
    cleanup.authUser = await cleanupExact(
      manifest.authUserId,
      context.cleanupTargets.deleteAuthUser,
      "Auth user",
      cleanupErrors,
    )
  }
  for (const id of manifest.mailpitMessageIds) {
    cleanup.mailpitMessages.push(
      await cleanupExact(
        id,
        context.cleanupTargets.deleteMailpitMessage,
        "Mailpit message",
        cleanupErrors,
      ),
    )
  }
  for (const tempPath of manifest.tempPaths) {
    try {
      try {
        await lstat(tempPath)
      } catch (error) {
        if (error?.code === "ENOENT") {
          cleanup.tempPaths.push("absent")
          continue
        }
        throw error
      }
      await rm(tempPath, { force: true, recursive: true })
      cleanup.tempPaths.push("removed")
    } catch (error) {
      cleanupErrors.push(error)
      cleanup.tempPaths.push("failed")
    }
  }
}

async function cleanupExact(id, operation, label, cleanupErrors) {
  if (typeof operation !== "function") {
    cleanupErrors.push(new Error(`${label} cleanup is not configured for an owned exact target`))
    return "failed"
  }
  try {
    await operation(id)
    return "deleted"
  } catch (error) {
    cleanupErrors.push(error)
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

function setExactIdentity(manifest, key, value) {
  if (value === undefined || value === null) return
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be exact`)
  if (manifest[key] !== null && manifest[key] !== value) {
    throw new Error(`${key} cannot change within a run`)
  }
  manifest[key] = value
}

function addExactValue(values, value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be exact`)
  if (!values.includes(value)) values.push(value)
}

function trackOwnedPid(context, pid) {
  if (Number.isInteger(pid) && pid > 0 && !context.manifest.ownedPids.includes(pid)) {
    context.manifest.ownedPids.push(pid)
  }
}

async function writeReadyMarker(context) {
  if (
    !context.configSnapshot ||
    !context.supabaseOwned ||
    !context.nextReady ||
    !context.nextChild?.pid ||
    !context.browserCommand?.child?.pid
  ) {
    throw new Error("Auth E2E readiness prerequisites are not owned and tracked")
  }
  const readyPath = process.env.SPOLINK_AUTH_E2E_READY_FILE
  if (!readyPath) return
  const body = `${JSON.stringify({
    browserPid: context.browserCommand.child.pid,
    mode: context.manifest.mode,
    ownedPidCount: context.manifest.ownedPids.length,
    runId: context.manifest.runId,
  })}\n`
  await writeReadyFile(readyPath, body)
  addExactValue(context.manifest.tempPaths, readyPath, "Ready marker path")
}

async function writeReadyFile(readyPath, body) {
  try {
    await writeFile(readyPath, body, { flag: "wx", mode: 0o600 })
    await chmod(readyPath, 0o600)
    return
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
  }
  const pathStats = await lstat(readyPath)
  if (!pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.size !== 0) {
    throw new Error("Auth E2E ready marker path contains stale state")
  }
  const handle = await open(readyPath, "r+")
  try {
    const handleStats = await handle.stat()
    if (!handleStats.isFile() || handleStats.size !== 0) {
      throw new Error("Auth E2E ready marker path changed before write")
    }
    await handle.writeFile(body)
    await handle.chmod(0o600)
  } finally {
    await handle.close()
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

function installSignals(context, repoRoot = process.cwd()) {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = async () => {
      if (!context.signalExitPromise) {
        context.shuttingDown = true
        context.signalExitPromise = (async () => {
          try {
            await withDeadline(cleanupOnce(context, repoRoot, new Error(signal)), 30_000)
          } catch (error) {
            console.error(error instanceof Error ? error.message : String(error))
          }
          process.exit(signal === "SIGINT" ? 130 : 143)
        })()
      }
      await context.signalExitPromise
    }
    context.signalHandlers.push({ handler, signal })
    process.on(signal, handler)
  }
}

function uninstallSignals(context) {
  for (const { handler, signal } of context.signalHandlers) {
    process.off(signal, handler)
  }
  context.signalHandlers = []
}

async function withDeadline(promise, ms) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Auth lifecycle signal cleanup exceeded ${ms}ms`)),
      ms,
    )
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
