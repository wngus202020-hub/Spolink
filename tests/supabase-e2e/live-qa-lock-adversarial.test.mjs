import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { ensureAuthGatewayReady } from "./auth-rls/runtime.mjs"
import { acquireLiveQaLock } from "./live-qa-lock.mjs"

let fixtureRoot

test.beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "spolink-live-qa-lock-tests-"))
  assert.equal((await stat(fixtureRoot)).mode & 0o777, 0o700)
})

test.afterEach(async () => {
  assert.equal(fixtureRoot.startsWith(join(tmpdir(), "spolink-live-qa-lock-tests-")), true)
  await rm(fixtureRoot, { force: true, recursive: true })
})

test("release refuses to remove a lock now owned by another token", async () => {
  const lockDir = testLockDir("owner-mismatch")
  const release = await acquireLiveQaLock("owner-a", { lockDir })
  await writeOwner(lockDir, { owner: "owner-b", ownerToken: randomUUID(), pid: process.pid })

  await assert.rejects(release, /owned by another process|owner mismatch/i)
  assert.equal((await stat(lockDir)).isDirectory(), true)
})

test("malformed and missing owner metadata fail closed and remain bounded", async () => {
  const lockDir = testLockDir("malformed")
  await mkdir(lockDir, { recursive: true, mode: 0o700 })
  await writeFile(join(lockDir, "owner.json"), "{bad json", { mode: 0o600 })

  const startedAt = Date.now()
  await assert.rejects(
    acquireLiveQaLock("waiter", { lockDir, timeoutMs: 80, waitMs: 10 }),
    /Timed out|unreadable|malformed/i,
  )
  assert.equal(Date.now() - startedAt < 1_000, true)
  assert.equal(await readFile(join(lockDir, "owner.json"), "utf8"), "{bad json")

  const missingOwnerDir = testLockDir("missing-owner")
  await mkdir(missingOwnerDir, { recursive: true, mode: 0o700 })
  await assert.rejects(
    acquireLiveQaLock("waiter", { lockDir: missingOwnerDir, timeoutMs: 80, waitMs: 10 }),
    /Timed out/i,
  )
  assert.equal((await stat(missingOwnerDir)).isDirectory(), true)
})

test("invalid PID metadata fails closed without consulting liveness", async () => {
  const invalidPids = [0, -1, 1.5, 2_147_483_648]
  for (const pid of invalidPids) {
    const lockDir = testLockDir(`invalid-pid-${String(pid).replace(".", "-")}`)
    await mkdir(lockDir, { recursive: true, mode: 0o700 })
    await writeOwner(lockDir, { owner: "invalid", ownerToken: randomUUID(), pid })
    let livenessCalls = 0

    await assert.rejects(
      acquireLiveQaLock("waiter", {
        livenessProbe: () => {
          livenessCalls += 1
          return false
        },
        lockDir,
        timeoutMs: 80,
        waitMs: 10,
      }),
      /Timed out/i,
    )
    assert.equal(livenessCalls, 0)
    assert.equal((await stat(lockDir)).isDirectory(), true)
  }
})

test("dead owner metadata times out without deletion", async () => {
  const lockDir = testLockDir("dead-owner")
  await mkdir(lockDir, { recursive: true, mode: 0o700 })
  const owner = { owner: "dead", ownerToken: randomUUID(), pid: 9_999_999 }
  await writeOwner(lockDir, owner)

  const startedAt = Date.now()
  await assert.rejects(
    acquireLiveQaLock("replacement", {
      livenessProbe: () => {
        throw killError("ESRCH")
      },
      lockDir,
      timeoutMs: 80,
      waitMs: 10,
    }),
    /Timed out/i,
  )
  assert.equal(Date.now() - startedAt < 1_000, true)
  assert.deepEqual(
    JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8")).ownerToken,
    owner.ownerToken,
  )
})

test("EPERM liveness stays alive and unexpected liveness errors propagate", async () => {
  const epermLockDir = testLockDir("eperm")
  await mkdir(epermLockDir, { recursive: true, mode: 0o700 })
  await writeOwner(epermLockDir, { owner: "eperm", ownerToken: randomUUID(), pid: process.pid })
  await assert.rejects(
    acquireLiveQaLock("waiter", {
      livenessProbe: () => {
        throw killError("EPERM")
      },
      lockDir: epermLockDir,
      timeoutMs: 80,
      waitMs: 10,
    }),
    /Timed out/i,
  )
  assert.equal((await stat(epermLockDir)).isDirectory(), true)

  const unknownLockDir = testLockDir("unknown-liveness")
  await mkdir(unknownLockDir, { recursive: true, mode: 0o700 })
  await writeOwner(unknownLockDir, { owner: "unknown", ownerToken: randomUUID(), pid: process.pid })
  await assert.rejects(
    acquireLiveQaLock("waiter", {
      livenessProbe: () => {
        throw killError("EACCES")
      },
      lockDir: unknownLockDir,
      timeoutMs: 80,
      waitMs: 10,
    }),
    /EACCES/,
  )
  assert.equal((await stat(unknownLockDir)).isDirectory(), true)
})

test("two concurrent contenders time out without deleting the current owner", async () => {
  const lockDir = testLockDir("contenders")
  const release = await acquireLiveQaLock("current", { lockDir })
  const contenders = await Promise.allSettled([
    acquireLiveQaLock("contender-a", { lockDir, timeoutMs: 80, waitMs: 10 }),
    acquireLiveQaLock("contender-b", { lockDir, timeoutMs: 80, waitMs: 10 }),
  ])

  assert.deepEqual(
    contenders.map((entry) => entry.status),
    ["rejected", "rejected"],
  )
  assert.equal(JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8")).owner, "current")
  await release()

  const nextRelease = await acquireLiveQaLock("next", { lockDir, timeoutMs: 100, waitMs: 10 })
  await nextRelease()
})

test("default-equivalent sentinel lock in temp root is never cleaned as unrelated owner", async () => {
  const sentinelLockDir = join(fixtureRoot, "spolink-supabase-e2e-live-qa.lock")
  await mkdir(sentinelLockDir, { recursive: true, mode: 0o700 })
  const sentinel = { owner: "sentinel", ownerToken: randomUUID(), pid: process.pid }
  await writeOwner(sentinelLockDir, sentinel)

  const release = await acquireLiveQaLock("separate-owner", { lockDir: testLockDir("separate") })
  await release()

  assert.equal(
    JSON.parse(await readFile(join(sentinelLockDir, "owner.json"), "utf8")).ownerToken,
    sentinel.ownerToken,
  )
})

test("exception-safe caller cleanup can release and reacquire the lock", async () => {
  const lockDir = testLockDir("exception")
  const firstRelease = await acquireLiveQaLock("exception-owner", { lockDir })
  try {
    throw new Error("injected cleanup failure")
  } catch (error) {
    assert.match(error.message, /injected cleanup failure/)
  } finally {
    await firstRelease()
  }

  const secondRelease = await acquireLiveQaLock("next-owner", { lockDir, timeoutMs: 100 })
  await secondRelease()
})

test("signal cleanup removes only the matching owned lock", async () => {
  const lockDir = testLockDir("signal")
  const child = spawn(process.execPath, ["tests/supabase-e2e/live-qa-lock-signal-child.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SPOLINK_SIGNAL_LOCK_DIR: lockDir },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const ready = await waitForChildReady(child)
  assert.equal(ready, "ready")

  child.kill("SIGTERM")
  const exit = await waitForExit(child)
  assert.equal(exit.signal ?? exit.code, 143)
  await assert.rejects(stat(lockDir), /ENOENT/)
})

test("degraded auth readiness fails closed without lifecycle command text", async () => {
  const runtimeSource = await readFile("tests/supabase-e2e/auth-rls/runtime.mjs", "utf8")
  assert.equal(/supabase:(?:start|stop|reset)/.test(runtimeSource), false)

  await assert.rejects(
    ensureAuthGatewayReady({
      fetch: async () => new Response(null, { status: 503 }),
      readLocalStatus: async () => ({ apiUrl: "http://127.0.0.1:54321" }),
      retryCount: 2,
      waitMs: 1,
    }),
    /main executor must start or reset Supabase/i,
  )
})

function testLockDir(name) {
  return join(fixtureRoot, `${name}-${randomUUID()}.lock`)
}

async function writeOwner(lockDir, owner) {
  await writeFile(
    join(lockDir, "owner.json"),
    JSON.stringify({ acquiredAt: new Date().toISOString(), ...owner }),
    { mode: 0o600 },
  )
}

function killError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function waitForChildReady(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.stdout.once("data", (chunk) => resolve(String(chunk).trim()))
    child.once("exit", (code, signal) => reject(new Error(`child exited early: ${code} ${signal}`)))
  })
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => resolve({ code, signal }))
  })
}
