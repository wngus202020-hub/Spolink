import { randomUUID } from "node:crypto"
import { readFileSync, rmSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"

const defaultLockDir = join(tmpdir(), "spolink-supabase-e2e-live-qa.lock")
const defaultTimeoutMs = 180_000
const defaultWaitMs = 100
const maxPid = 2_147_483_647
const ownerTokenPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const oldestOwnerTimestampMs = Date.UTC(2020, 0, 1)
const futureTimestampSkewMs = 60_000

export async function acquireLiveQaLock(owner, options = {}) {
  const startedAt = Date.now()
  const lockDir = options.lockDir ?? defaultLockDir
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const waitMs = options.waitMs ?? defaultWaitMs
  const livenessProbe = options.livenessProbe ?? isAlive
  const ownerPath = join(lockDir, "owner.json")
  const ownership = {
    acquiredAt: new Date().toISOString(),
    host: hostname(),
    owner,
    ownerToken: randomUUID(),
    pid: process.pid,
  }

  await mkdir(dirname(lockDir), { recursive: true, mode: 0o700 })
  const deadline = startedAt + timeoutMs
  while (Date.now() < deadline) {
    if (await tryAcquire(lockDir, ownerPath, ownership, livenessProbe)) {
      let released = false
      const cleanup = () => releaseSync(lockDir, ownerPath, ownership)
      const uninstall = installProcessCleanup(cleanup)
      return async () => {
        if (released) return
        released = true
        uninstall()
        await releaseOwnedLock(lockDir, ownerPath, ownership)
      }
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs > 0) await delay(Math.min(waitMs, remainingMs))
  }
  throw new Error(`Timed out waiting for live QA fixture lock: ${owner}`)
}

async function tryAcquire(lockDir, ownerPath, ownership, livenessProbe) {
  try {
    await mkdir(lockDir, { mode: 0o700 })
    await writeFile(ownerPath, JSON.stringify(ownership), { mode: 0o600 })
    return true
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error
    await inspectExistingLock(ownerPath, livenessProbe)
    return false
  }
}

async function inspectExistingLock(ownerPath, livenessProbe) {
  const current = await readOwner(ownerPath)
  if (current.kind !== "valid") return false
  probeOwnerAlive(livenessProbe, current.owner.pid)
  return false
}

async function releaseOwnedLock(lockDir, ownerPath, ownership) {
  const current = await readOwner(ownerPath)
  if (current.kind === "missing") return
  if (!matchesOwner(current, ownership)) {
    throw new Error(`Refusing to release live QA lock owned by another process: ${lockDir}`)
  }
  await rm(lockDir, { force: true, recursive: true })
}

function releaseSync(lockDir, ownerPath, ownership) {
  try {
    const current = readOwnerSync(ownerPath)
    if (current.kind === "missing" || !matchesOwner(current, ownership)) return
    rmSync(lockDir, { force: true, recursive: true })
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}

async function readOwner(ownerPath) {
  try {
    return parseOwner(JSON.parse(await readFile(ownerPath, "utf8")))
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "malformed" }
    if (isNodeError(error, "ENOENT")) return { kind: "missing" }
    throw error
  }
}

function readOwnerSync(ownerPath) {
  try {
    return parseOwner(JSON.parse(readFileSync(ownerPath, "utf8")))
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "malformed" }
    if (isNodeError(error, "ENOENT")) return { kind: "missing" }
    throw error
  }
}

function parseOwner(value) {
  if (
    !isPlainObject(value) ||
    typeof value.owner !== "string" ||
    value.owner.trim() === "" ||
    typeof value.ownerToken !== "string" ||
    !ownerTokenPattern.test(value.ownerToken) ||
    !isValidPid(value.pid) ||
    !isCanonicalTimestamp(value.acquiredAt)
  ) {
    return { kind: "malformed" }
  }
  return { kind: "valid", owner: value }
}

function matchesOwner(current, ownership) {
  return (
    current.kind === "valid" &&
    current.owner.owner === ownership.owner &&
    current.owner.ownerToken === ownership.ownerToken &&
    current.owner.pid === ownership.pid
  )
}

function isAlive(pid) {
  process.kill(pid, 0)
  return true
}

function probeOwnerAlive(livenessProbe, pid) {
  try {
    return livenessProbe(pid)
  } catch (error) {
    if (isNodeError(error, "ESRCH")) return false
    if (isNodeError(error, "EPERM")) return true
    throw error
  }
}

function isValidPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0 && pid <= maxPid
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false
  const parsedMs = Date.parse(value)
  if (Number.isNaN(parsedMs)) return false
  if (new Date(parsedMs).toISOString() !== value) return false
  return parsedMs >= oldestOwnerTimestampMs && parsedMs <= Date.now() + futureTimestampSkewMs
}

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  )
}

function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function installProcessCleanup(cleanup) {
  const exitHandler = () => cleanup()
  const signalHandler = (signal) => {
    cleanup()
    process.exit(signal === "SIGINT" ? 130 : 143)
  }
  process.once("exit", exitHandler)
  process.once("SIGINT", signalHandler)
  process.once("SIGTERM", signalHandler)
  return () => {
    process.off("exit", exitHandler)
    process.off("SIGINT", signalHandler)
    process.off("SIGTERM", signalHandler)
  }
}
