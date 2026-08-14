import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { withRuntimeLock } from "../../scripts/supabase-local.mjs"

test("runtime lock rejects an existing live owner without running the action", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-lock-"))
  try {
    const lockPath = path.join(dir, "runtime.lock")
    const owner = { pid: process.pid, createdAt: new Date().toISOString() }
    await writeFile(lockPath, JSON.stringify(owner), { mode: 0o600 })
    let actionRan = false

    await assert.rejects(
      withRuntimeLock(lockPath, async () => {
        actionRan = true
      }),
      /in progress/i,
    )

    assert.equal(actionRan, false)
    assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), owner)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime lock removes only a stale dead-PID lock and retries acquisition", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-lock-"))
  try {
    const lockPath = path.join(dir, "runtime.lock")
    const staleOwner = { pid: await completedChildPid(), createdAt: new Date().toISOString() }
    await writeFile(lockPath, JSON.stringify(staleOwner), { mode: 0o600 })

    const result = await withRuntimeLock(lockPath, async () => {
      const activeOwner = JSON.parse(await readFile(lockPath, "utf8"))
      assert.equal(activeOwner.pid, process.pid)
      assert.equal((await stat(lockPath)).mode & 0o777, 0o600)
      return "acquired"
    })

    assert.equal(result, "acquired")
    await assert.rejects(access(lockPath), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime lock rejects malformed existing locks without deleting them", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-lock-"))
  try {
    const lockPath = path.join(dir, "runtime.lock")
    await writeFile(lockPath, "{bad json", { mode: 0o600 })

    await assert.rejects(
      withRuntimeLock(lockPath, async () => {
        throw new Error("action must not run")
      }),
      /invalid/i,
    )

    assert.equal(await readFile(lockPath, "utf8"), "{bad json")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime lock cleans up the acquired lock when the action fails", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-lock-"))
  try {
    const lockPath = path.join(dir, "runtime.lock")

    await assert.rejects(
      withRuntimeLock(lockPath, async () => {
        throw new Error("boom")
      }),
      /boom/,
    )

    await assert.rejects(access(lockPath), /ENOENT/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

async function completedChildPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  const pid = child.pid
  assert.equal(typeof pid, "number")
  await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })
  await assert.rejects(
    Promise.resolve().then(() => process.kill(pid, 0)),
    /ESRCH/,
  )
  return pid
}
