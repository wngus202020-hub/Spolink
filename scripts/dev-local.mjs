import { randomUUID } from "node:crypto"
import net from "node:net"
import process from "node:process"

import { buildLocalAppEnv } from "./supabase-local/app-env.mjs"
import { RUNTIME_RECEIPT_PATH } from "./supabase-local/constants.mjs"
import { scanProjectResources } from "./supabase-local/docker.mjs"
import { runStart, runStop } from "./supabase-local/lifecycle.mjs"
import {
  LocalSupabaseNotRunningError,
  readGuardedLocalStatus,
} from "./supabase-local/local-status.mjs"
import { startNextDev } from "./supabase-local/next-dev.mjs"
import { maybeReadRuntimeReceipt, readRuntimeReceipt } from "./supabase-local/receipt.mjs"
import { assertStoppedState } from "./supabase-local/stopped-state.mjs"
import { absoluteEvidencePath } from "./supabase-local/utils.mjs"

const HOST = "127.0.0.1"
const PORT = 3000
const APP_URL = `http://${HOST}:${PORT}`
const primaryAggregateErrors = new WeakSet()

export async function runLocalDev(options = {}) {
  const runtime = options.runtime ?? createRuntime(options)
  const cleanupErrors = []
  let primaryError = null
  let next = null
  let startedByLauncher = false
  let runId

  try {
    if (!(await runtime.isNextPortFree())) {
      throw new LocalDevError("occupied", `${APP_URL} is occupied`)
    }

    let status = null
    try {
      status = await runtime.readStatus()
    } catch (error) {
      if (!(error instanceof LocalSupabaseNotRunningError)) throw error
      status = null
    }
    if (status) {
      const receipt = await runtime.readReceipt()
      runId = receipt.runId
    } else {
      const resources = await runtime.scanResources()
      if (hasResources(resources)) {
        throw new LocalDevError(
          "unowned_runtime",
          "Supabase resources lack a current matching receipt",
        )
      }
      const receipt = await runtime.readReceipt({ optional: true })
      runId = receipt?.runId ?? `spolink-${randomUUID()}`
      startedByLauncher = true
      await runtime.startSupabase(runId)
      status = await runtime.readStatus()
    }

    next = await runtime.startNext({
      runId,
      appEnv: runtime.buildAppEnv(status),
    })
    runtime.log(
      JSON.stringify({ runtime: startedByLauncher ? "started" : "reused", startedByLauncher }),
    )
    runtime.log(APP_URL)
    await next.closed
  } catch (error) {
    primaryError = error
    rememberPrimaryAggregate(error)
  } finally {
    if (next) await captureCleanup(cleanupErrors, () => next.stop(null))
    if (startedByLauncher) {
      await captureCleanup(cleanupErrors, () => runtime.stopSupabase(runId))
      await captureCleanup(cleanupErrors, () => runtime.assertSupabaseStopped(runId))
    }
  }

  if (primaryError && cleanupErrors.length > 0) {
    const aggregate = new AggregateError(
      [primaryError, ...cleanupErrors],
      "Local dev startup and cleanup failed",
    )
    primaryAggregateErrors.add(aggregate)
    throw aggregate
  }
  if (primaryError) throw primaryError
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "Local dev cleanup failed")
  return { startedByLauncher }
}

function createRuntime(options) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const env = options.env ?? process.env
  const receiptPath = options.receiptPath ?? absoluteEvidencePath(RUNTIME_RECEIPT_PATH)
  return {
    isNextPortFree,
    readStatus: () => readGuardedLocalStatus({ repoRoot, env }),
    scanResources: scanProjectResources,
    readReceipt: ({ optional = false } = {}) =>
      optional ? maybeReadRuntimeReceipt(receiptPath) : readRuntimeReceipt(receiptPath),
    startSupabase: (runId) => runStart({ repoRoot, env, receiptPath, runId }),
    buildAppEnv: (status) => buildLocalAppEnv(status, env),
    startNext: ({ runId, appEnv }) => startNextDev({ repoRoot, receiptPath, runId, appEnv }),
    stopSupabase: (runId) => runStop({ repoRoot, env, receiptPath, runId }),
    assertSupabaseStopped: (runId) => assertStoppedState({ receiptPath, runId }),
    log: console.log,
  }
}

function hasResources(resources) {
  return resources.containers.length + resources.volumes.length + resources.networks.length > 0
}

async function captureCleanup(errors, action) {
  try {
    await action()
  } catch (error) {
    errors.push(error)
  }
}

function isNextPortFree() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") resolve(false)
      else reject(error)
    })
    server.listen(PORT, HOST, () => server.close(() => resolve(true)))
  })
}

class LocalDevError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "LocalDevError"
    this.code = code
  }
}

async function main() {
  try {
    await runLocalDev()
  } catch (error) {
    console.error(`local dev failed: ${errorCode(error)}`)
    process.exitCode = 1
  }
}

export function errorCode(error) {
  const primaryError = primaryAggregateMember(error)
  if (primaryError) return `${plainErrorCode(primaryError)}_cleanup_failed`
  return plainErrorCode(error)
}

function plainErrorCode(error) {
  if (error instanceof LocalDevError) return error.code
  if (error instanceof AggregateError) return "cleanup_failed"
  return "runtime_failed"
}

function rememberPrimaryAggregate(error) {
  if (error instanceof AggregateError) primaryAggregateErrors.add(error)
}

function primaryAggregateMember(error) {
  if (!(error instanceof AggregateError) || !primaryAggregateErrors.has(error)) return null
  const [first] = error.errors
  return primaryAggregateErrors.has(first) ? primaryAggregateMember(first) : first
}

if (process.argv[1] === new URL(import.meta.url).pathname) await main()
