import { capturePort3002 } from "../supabase-e2e/next-server.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"
import { snapshotSupabaseCliTemp } from "./mypage-profile-edit-runtime-cleanup.mjs"
import { buildChildEnv } from "./process.mjs"

export function classifyMypageDocumentDiagnosis({
  documentFinished,
  headingMatched,
  profileMatched,
  status,
}) {
  if (!documentFinished || status === null || status >= 500) return "server-boundary"
  if (status === 401 || (status >= 300 && status < 400) || !profileMatched) {
    return "session-profile"
  }
  if (status === 200 && headingMatched && profileMatched) return "healthy"
  return "navigation-wait"
}

export function createRunManifest({
  configSnapshotHash = null,
  evidencePaths = [],
  mode,
  runId,
  tempPaths = [],
}) {
  if (typeof runId !== "string" || runId.length === 0) throw new Error("runId is required")
  if (typeof mode !== "string" || mode.length === 0) throw new Error("mode is required")
  if (tempPaths.length > 0)
    throw new Error("Arbitrary temp paths are rejected; use an owned handle")
  return {
    runId,
    mode,
    authUserId: null,
    profileId: null,
    mailpitMessageIds: [],
    configSnapshotHash,
    ownedPids: [],
    tempPaths: [],
    evidencePaths: [...evidencePaths],
  }
}

export function buildApiTestEnv(parentEnv, baseUrl, status) {
  return buildChildEnv(parentEnv, {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    NODE_ENV: "test",
    SPOLINK_TEST_BASE_URL: baseUrl,
  })
}

export async function createLifecycleContext(reservation, options = {}) {
  const runId = options.runId ?? `auth-${Date.now().toString(36)}-${process.pid}`
  const repoRoot = options.repoRoot ?? process.cwd()
  return {
    activeCommand: null,
    authWorkspace: null,
    before3002: await capturePort3002(),
    browserCommand: null,
    browserContexts: [],
    browserOwned: false,
    cleanupPromise: null,
    cleanupReceiptPath: await resolveCleanupReceiptPath(options.cleanupReceiptPath, repoRoot),
    cleanupTargets: options.cleanupTargets ?? {},
    manifest: createRunManifest({
      evidencePaths: options.evidencePaths ?? [],
      mode: options.mode ?? "unknown",
      runId,
      tempPaths: options.tempPaths ?? [],
    }),
    nextReady: false,
    nextChild: null,
    nextOutputCapture: null,
    nextRawOutputDir:
      options.nextRawOutputDir ?? process.env["SPOLINK_AUTH_E2E_NEXT_RAW_OUTPUT_DIR"] ?? null,
    nextServerSummaryPath:
      options.nextServerSummaryPath ??
      process.env["SPOLINK_AUTH_E2E_NEXT_SERVER_SUMMARY_FILE"] ??
      null,
    observers: [],
    readyPromise: null,
    released: false,
    repoRoot,
    reservation,
    shutdownOrder: [],
    signalExitPromise: null,
    signalHandlers: [],
    supabaseOwned: false,
    supabaseTempSnapshot: await snapshotSupabaseCliTemp(repoRoot),
  }
}

export async function resolveCleanupReceiptPath(inputPath, repoRoot = process.cwd()) {
  if (!inputPath) return null
  return resolveEvidenceChildPath(inputPath, { kind: "file", repoRoot, suffix: ".json" })
}

export function addExactValue(values, value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be exact`)
  if (!values.includes(value)) values.push(value)
}

export function setExactIdentity(manifest, key, value) {
  if (value === undefined || value === null) return
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} must be exact`)
  if (manifest[key] !== null && manifest[key] !== value) {
    throw new Error(`${key} cannot change within a run`)
  }
  manifest[key] = value
}

export function trackOwnedPid(context, pid) {
  if (Number.isInteger(pid) && pid > 0 && !context.manifest.ownedPids.includes(pid)) {
    context.manifest.ownedPids.push(pid)
  }
}
