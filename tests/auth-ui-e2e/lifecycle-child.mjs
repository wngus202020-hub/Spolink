import { spawn } from "node:child_process"

import { addExactValue, setExactIdentity, trackOwnedPid } from "./lifecycle-core.mjs"
import { buildChildEnv, runBuffered, trackActiveCommand } from "./process.mjs"
import { createBoundedChildOutputCapture } from "./raw-output.mjs"

export function createLifecycleControl(context, repoRoot) {
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
          context.readyPromise = assertReadyOwnership(context)
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

export async function startNextChild(
  context,
  status,
  enableCoachUiFixtures,
  enableAdminOperationsUiFixtures = false,
) {
  const port = context.reservation.port
  const outputCapture = await createBoundedChildOutputCapture({
    rawDir: context.nextRawOutputDir,
    retainRawOutput: process.env["SPOLINK_AUTH_E2E_RETAIN_RAW_OUTPUT"] === "1",
  })
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: context.repoRoot,
      env: buildChildEnv(process.env, {
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
        ...(process.env["SPOLINK_VISUAL_QA_DIR"]
          ? { NEXT_PRIVATE_DISABLE_DEV_OVERLAY_UX: "1" }
          : {}),
        ...(enableCoachUiFixtures ? { SPOLINK_COACH_UI_FIXTURES: "enabled" } : {}),
        ...(enableAdminOperationsUiFixtures
          ? {
              SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE: "enabled",
              SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE: "enabled",
            }
          : {}),
        SPOLINK_AUTH_FLOW_SECRET: Buffer.alloc(32, 7).toString("base64url"),
      }),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  outputCapture.attach(child)
  return { child, outputCapture }
}

export async function waitForConfiguredState(baseUrl) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/config/supabase`)
      if (response.ok && (await response.json()).configured === true) return
    } catch {
      // Retry until the bounded readiness deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Configured Next readiness timed out")
}

export async function runRequired(context, command, args, cwd) {
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

export function injectAuthFailure(point) {
  if (process.env.SPOLINK_AUTH_E2E_INJECT_FAILURE === point) {
    throw new Error(`Injected auth E2E failure: ${point}`)
  }
}

async function assertReadyOwnership(context) {
  if (
    !context.authWorkspace ||
    !context.supabaseOwned ||
    !context.nextReady ||
    !context.nextChild?.pid ||
    !context.browserCommand?.child?.pid
  ) {
    throw new Error("Auth E2E readiness prerequisites are not owned and tracked")
  }
}
