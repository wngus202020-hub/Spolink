import { spawn } from "node:child_process"
import http from "node:http"
import net from "node:net"
import process from "node:process"

import { RUNTIME_RECEIPT_PATH } from "./constants.mjs"
import { runtimeLockPath, withRuntimeLock } from "./lock.mjs"
import {
  assertNextOwnershipVacant,
  readRuntimeReceipt,
  registerNextOwnership,
  unregisterNextOwnership,
  writeRuntimeReceipt,
} from "./receipt.mjs"
import { absoluteEvidencePath, delay, isPlainObject, signalProcessGroup } from "./utils.mjs"

const HOST = "127.0.0.1"
const PORT = 3000
const APP_ENV_KEYS =
  "HOME NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_URL PATH SPOLINK_AUTH_FLOW_SECRET SUPABASE_SERVICE_ROLE_KEY TMPDIR".split(
    " ",
  )
const NEXT_ARGS = `pnpm exec next dev --webpack --hostname ${HOST} --port ${PORT}`.split(" ")

export async function startNextDev(options) {
  const runtime = options.runtime ?? defaultRuntime()
  const receiptPath = options.receiptPath ?? absoluteEvidencePath(RUNTIME_RECEIPT_PATH)
  const reservation = await runtime.reservePort()
  if (!reservation) throw new Error(`${HOST}:${PORT} is occupied`)

  let child
  try {
    assertAppEnv(options.appEnv)
    child = await withRuntimeLock(runtimeLockPath(receiptPath), async () => {
      const receipt = await readRuntimeReceipt(receiptPath)
      assertNextOwnershipVacant(receipt, options.runId)
      await reservation.release()
      const spawned = runtime.spawnChild("corepack", NEXT_ARGS, {
        cwd: options.repoRoot ?? process.cwd(),
        env: options.appEnv,
        detached: true,
        shell: false,
        stdio: "inherit",
      })
      await waitForSpawn(spawned)
      child = spawned
      const ownership = { runId: options.runId, pid: spawned.pid, port: PORT }
      const nextReceipt = registerNextOwnership(receipt, ownership)
      await writeRuntimeReceipt(receiptPath, nextReceipt)
      child = undefined
      return spawned
    })
  } catch (error) {
    await reservation.release()
    if (child) {
      try {
        await stopUnregisteredChild(child, runtime, options.terminateGraceMs ?? 10_000)
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Next registration and cleanup failed")
      }
    }
    throw error
  }

  const lifecycle = manageChild({
    child,
    receiptPath,
    runId: options.runId,
    runtime,
    terminateGraceMs: options.terminateGraceMs ?? 10_000,
  })
  try {
    await Promise.race([
      waitForReadiness({
        runtime,
        timeoutMs: options.readinessTimeoutMs ?? 30_000,
        pollIntervalMs: options.pollIntervalMs ?? 250,
      }),
      lifecycle.exited.then(() => {
        throw new Error("Next child exited before configured readiness")
      }),
    ])
  } catch (error) {
    try {
      await lifecycle.stop("SIGTERM")
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Next startup and cleanup failed")
    }
    throw error
  }
  return { pid: child.pid, port: PORT, closed: lifecycle.closed, stop: lifecycle.stop }
}

async function stopUnregisteredChild(child, runtime, timeoutMs) {
  const exited = new Promise((resolve) => child.once("close", () => resolve(true)))
  const waitForExit = () => Promise.race([exited, runtime.sleep(timeoutMs).then(() => false)])
  runtime.killChild(child, "SIGTERM")
  if (!(await waitForExit())) {
    runtime.killChild(child, "SIGKILL")
    if (!(await waitForExit())) throw new Error("Owned Next child did not exit after SIGKILL")
  }
  if (!(await waitForPortRelease(runtime, timeoutMs))) throw new Error("Owned child kept port 3000")
}

function manageChild({ child, receiptPath, runId, runtime, terminateGraceMs }) {
  let resolveExit
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })
  let resolveClosed
  let rejectClosed
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  closed.catch(() => {})
  let cleanup
  const signals = ["SIGINT", "SIGTERM"]

  const finish = (signal) => {
    if (cleanup) return cleanup
    cleanup = withRuntimeLock(runtimeLockPath(receiptPath), async () => {
      const receipt = await readRuntimeReceipt(receiptPath)
      const nextReceipt = unregisterNextOwnership(receipt, {
        runId,
        pid: child.pid,
        port: PORT,
      })
      if (signal) {
        runtime.killChild(child, signal)
        const graceful = await Promise.race([
          exited.then(() => true),
          runtime.sleep(terminateGraceMs).then(() => false),
        ])
        if (!graceful) {
          runtime.killChild(child, "SIGKILL")
          await exited
        }
      }
      if (!(await waitForPortRelease(runtime, terminateGraceMs))) {
        if (signal) runtime.killChild(child, "SIGKILL")
        if (!(await waitForPortRelease(runtime, terminateGraceMs))) {
          throw new Error(`${HOST}:${PORT} was not released by the owned Next child`)
        }
      }
      await writeRuntimeReceipt(receiptPath, nextReceipt)
    })
    cleanup.then(resolveClosed, rejectClosed).finally(() => {
      for (const name of signals) runtime.signalSource.off(name, handlers[name])
    })
    return cleanup
  }
  const handlers = {
    SIGINT: () => void finish("SIGINT").catch(() => {}),
    SIGTERM: () => void finish("SIGTERM").catch(() => {}),
  }
  for (const name of signals) runtime.signalSource.on(name, handlers[name])
  child.once("close", (code, signal) => {
    resolveExit({ code, signal })
    queueMicrotask(() => void finish(null).catch(() => {}))
  })
  return { closed, exited, stop: finish }
}

async function waitForReadiness({ runtime, timeoutMs, pollIntervalMs }) {
  const deadline = runtime.now() + timeoutMs
  const url = `http://${HOST}:${PORT}/api/config/supabase`
  while (runtime.now() < deadline) {
    if ((await runtime.readConfigured(url)) === true) return
    await runtime.sleep(pollIntervalMs)
  }
  throw new Error("Next configured readiness timed out")
}

async function waitForPortRelease(runtime, timeoutMs) {
  const deadline = runtime.now() + timeoutMs
  do {
    if (await runtime.isPortFree()) return true
    await runtime.sleep(Math.min(50, timeoutMs))
  } while (runtime.now() < deadline)
  return false
}

function assertAppEnv(appEnv) {
  if (!isPlainObject(appEnv) || Object.keys(appEnv).sort().join("\0") !== APP_ENV_KEYS.join("\0")) {
    throw new Error("Next child requires the exact seven-key app environment")
  }
  for (const key of APP_ENV_KEYS) {
    if (typeof appEnv[key] !== "string" || appEnv[key].length === 0) {
      throw new Error(`Next child environment is missing ${key}`)
    }
  }
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve)
    child.once("error", reject)
  })
}

function defaultRuntime() {
  return {
    reservePort: reserveFixedPort,
    spawnChild: spawn,
    readConfigured,
    isPortFree: isFixedPortFree,
    killChild: signalProcessGroup,
    signalSource: process,
    now: Date.now,
    sleep: delay,
  }
}

async function isFixedPortFree() {
  const reservation = await reserveFixedPort()
  if (!reservation) return false
  await reservation.release()
  return true
}

function reserveFixedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    let released = false
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") resolve(null)
      else reject(error)
    })
    server.listen(PORT, HOST, () => {
      resolve({
        release: () => {
          if (released) return Promise.resolve()
          released = true
          return new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()))
          })
        },
      })
    })
  })
}

function readConfigured(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      let body = ""
      response.setEncoding("utf8")
      response.on("data", (chunk) => {
        body += chunk
      })
      response.on("end", () => {
        try {
          const parsed = JSON.parse(body)
          resolve(
            response.statusCode === 200 && isPlainObject(parsed) && parsed.configured === true,
          )
        } catch {
          resolve(false)
        }
      })
    })
    request.setTimeout(1_000, () => request.destroy())
    request.once("error", () => resolve(false))
  })
}
