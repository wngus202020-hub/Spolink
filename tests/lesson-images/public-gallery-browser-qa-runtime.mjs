import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

export const ACTION_TIMEOUT_MS = 12_000
export const CLEANUP_TIMEOUT_MS = 25_000
export const RUN_TIMEOUT_MS = 110_000
export const STARTUP_TIMEOUT_MS = 30_000

export function createProgressReporter(progress) {
  return (milestone, details = {}) => {
    const entry = { at: new Date().toISOString(), milestone, ...details }
    progress.push(entry)
    process.stdout.write(`${JSON.stringify(entry)}\n`)
  }
}

export async function withTimeout(label, timeoutMs, action, options = {}) {
  const controller = new AbortController()
  let timer
  let timedOut = false
  const actionPromise = Promise.resolve().then(() => action(controller.signal))
  try {
    return await Promise.race([
      actionPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    if (timedOut && options.waitForActionAfterAbort) {
      const result = await actionPromise
      if (options.returnActionAfterAbort) return result
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export function installFatalHandlers(onFatal) {
  const handlers = new Map()
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => onFatal(new Error(`Received ${signal}`), signal)
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  const uncaught = (error) => onFatal(error, "uncaughtException")
  const unhandled = (reason) =>
    onFatal(reason instanceof Error ? reason : new Error(String(reason)), "unhandledRejection")
  process.once("uncaughtException", uncaught)
  process.once("unhandledRejection", unhandled)

  return () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
    process.removeListener("uncaughtException", uncaught)
    process.removeListener("unhandledRejection", unhandled)
  }
}

export async function startOwnedNextServer({ onOwned, port, progress, repoRoot, signal, status }) {
  if (!(await isPortFree(port))) throw new Error(`Owned port ${port} is already occupied`)
  signal?.throwIfAborted()
  const tempRoot = await mkdtemp(path.join(tmpdir(), "spolink-task8-gallery-"))
  const server = { baseUrl: `http://127.0.0.1:${port}`, child: null, port, tempRoot }
  onOwned(server)
  progress("temp-copy-created")
  await runBounded(
    "rsync",
    [
      "-a",
      "--exclude",
      ".next",
      "--exclude",
      ".codegraph",
      "--exclude",
      ".omo",
      "--exclude",
      "node_modules",
      `${repoRoot}/`,
      `${tempRoot}/`,
    ],
    repoRoot,
    STARTUP_TIMEOUT_MS,
    signal,
  )
  signal?.throwIfAborted()
  await symlink(path.join(repoRoot, "node_modules"), path.join(tempRoot, "node_modules"))
  signal?.throwIfAborted()

  const output = { stderr: "", stdout: "" }
  const child = spawn(
    "corepack",
    ["pnpm", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: tempRoot,
      detached: true,
      env: {
        HOME: process.env.HOME,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  server.child = child
  server.output = output
  child.stdout.on("data", (chunk) => {
    output.stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    output.stderr += chunk
  })
  try {
    await withTimeout("Next startup", STARTUP_TIMEOUT_MS, async (startupSignal) => {
      const combinedSignal = signal ? AbortSignal.any([signal, startupSignal]) : startupSignal
      while (!combinedSignal.aborted) {
        if (child.exitCode !== null) throw new Error(`Owned Next exited ${child.exitCode}`)
        try {
          const response = await fetch(`${server.baseUrl}/api/config/supabase`, {
            signal: combinedSignal,
          })
          if (response.ok && (await response.json()).configured === true) return
        } catch (error) {
          if (combinedSignal.aborted) throw error
        }
        await delay(200)
      }
    })
  } catch (error) {
    await stopProcessGroup(child)
    await rm(tempRoot, { force: true, recursive: true })
    throw new Error(`${error.message}\n${output.stderr.slice(-1_000)}`)
  }
  progress("owned-next-ready", { pid: child.pid, port })

  return server
}

export async function cleanupOwnedServer(server, progress) {
  if (!server) return { portFree: true, processStopped: true, tempRemoved: true }
  await stopProcessGroup(server.child)
  await rm(server.tempRoot, { force: true, recursive: true })
  const portFree = await waitForPortFree(server.port)
  const processStopped =
    !server.child || server.child.exitCode !== null || server.child.signalCode !== null
  progress("owned-next-cleaned", { portFree })
  return {
    portFree,
    processStopped,
    tempRemoved: true,
  }
}

export async function validatePng(filePath, expectedWidth, expectedHeight) {
  const bytes = await readFile(filePath)
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error(`Invalid PNG signature: ${filePath}`)
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`Unexpected PNG dimensions ${width}x${height}: ${filePath}`)
  }
  if (bytes.byteLength < 10_000) throw new Error(`PNG is too small to be composited: ${filePath}`)
  return { bytes: bytes.byteLength, height, signature: "89504e470d0a1a0a", width }
}

async function runBounded(command, args, cwd, timeoutMs, externalSignal) {
  await withTimeout(
    `${command} ${args.join(" ")}`,
    timeoutMs,
    (signal) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] })
        let stderr = ""
        const abort = () => child.kill("SIGKILL")
        signal.addEventListener("abort", abort, { once: true })
        externalSignal?.addEventListener("abort", abort, { once: true })
        if (externalSignal?.aborted) abort()
        child.stderr.on("data", (chunk) => {
          stderr += chunk
        })
        child.once("error", reject)
        child.once("close", (code) => {
          externalSignal?.removeEventListener("abort", abort)
          if (externalSignal?.aborted) reject(externalSignal.reason)
          else if (code === 0) resolve()
          else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1_000)}`))
        })
      }),
  )
}

async function stopProcessGroup(child) {
  if (!child?.pid || child.exitCode !== null) return
  const closed = new Promise((resolve) => child.once("close", resolve))
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {}
  const graceful = await Promise.race([closed.then(() => true), delay(5_000).then(() => false)])
  if (graceful) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {}
  await Promise.race([closed, delay(3_000)])
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}

async function waitForPortFree(port) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isPortFree(port)) return true
    await delay(100)
  }
  return false
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
