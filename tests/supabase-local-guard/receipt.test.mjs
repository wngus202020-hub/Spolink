import assert from "node:assert/strict"
import fs from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { readMode0600JsonFile } from "../../scripts/supabase-local/utils.mjs"
import {
  assertStoppedState,
  createRuntimeReceipt,
  SUPABASE_PORTS,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"

test("mode-0600 JSON reader binds inspection and content to one no-follow file handle", async () => {
  const moduleSource = await readFile(
    new URL("../../scripts/supabase-local/utils.mjs", import.meta.url),
    "utf8",
  )
  const functionSource = readMode0600JsonFile.toString()
  assert.match(
    moduleSource,
    /import\s*\{(?=[^}]*\bconstants\b)(?=[^}]*\bopen\b)(?=[^}]*\breadFile\b)[^}]*\}\s*from\s*["']node:fs\/promises["']/su,
  )
  assert.doesNotMatch(functionSource, /\blstat\s*\(\s*filePath\s*\)/u)
  assert.doesNotMatch(functionSource, /\breadFile\s*\(\s*filePath\s*,/u)
  assert.doesNotMatch(functionSource, /\breadJsonFile\s*\(\s*filePath\s*\)/u)

  const openAssignments = [
    ...functionSource.matchAll(
      /\b(?:const\s+|let\s+)?([A-Za-z_$][\w$]*)\s*=\s*await\s+open\s*\(\s*filePath\s*,\s*constants\.O_RDONLY\s*\|\s*constants\.O_NOFOLLOW\s*\)/gu,
    ),
  ]
  assert.equal(openAssignments.length, 1)
  const handleName = openAssignments[0]?.[1]
  assert.ok(handleName)
  const escapedHandleName = handleName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const statIndex = functionSource.search(new RegExp(`\\b${escapedHandleName}\\.stat\\s*\\(`, "u"))
  const readIndex = functionSource.search(
    new RegExp(`\\b${escapedHandleName}\\.readFile\\s*\\(\\s*["']utf8["']\\s*\\)`, "u"),
  )
  const closeIndex = functionSource.search(
    new RegExp(`\\b${escapedHandleName}\\.close\\s*\\(`, "u"),
  )
  assert.ok(statIndex > openAssignments[0].index)
  assert.ok(readIndex > statIndex)
  assert.ok(closeIndex > readIndex)
  assert.match(functionSource, /error\?\.code\s*===\s*["']ELOOP["']/u)
  assert.equal(functionSource.match(/throw\s+new\s+Error\s*\(\s*modeError\s*\)/gu)?.length, 2)
  assert.match(
    functionSource,
    /catch\s*\(\s*error\s*\)\s*\{[^{}]*primaryError\s*=\s*error[^{}]*throw\s+error/su,
  )
  assert.match(functionSource, /finally\s*\{/u)
  assert.match(
    functionSource,
    /catch\s*\(\s*error\s*\)\s*\{\s*if\s*\(\s*!primaryError\s*\)\s*\{\s*closeError\s*=\s*error/su,
  )
  assert.match(functionSource, /if\s*\(\s*closeError\s*\)\s*\{\s*throw\s+closeError/su)

  const dir = await mkdtemp(path.join(tmpdir(), "spolink-atomic-reader-"))
  const originalOpen = fs.promises.open
  let openPatched = false
  try {
    const validPath = path.join(dir, "valid.json")
    const malformedPath = path.join(dir, "malformed.json")
    const probePath = path.join(dir, "probe.json")
    await writeFile(validPath, '{"ok":true}', { mode: 0o600 })
    await writeFile(malformedPath, "{", { mode: 0o600 })
    await writeFile(probePath, "{}", { mode: 0o600 })
    assert.deepEqual(await readMode0600JsonFile(validPath, "mode error"), { ok: true })
    await assert.rejects(readMode0600JsonFile(path.join(dir, "missing.json"), "mode error"), {
      code: "ENOENT",
    })

    const probeHandle = await open(probePath, "r")
    const closeDescriptor = Object.getOwnPropertyDescriptor(probeHandle, "close")
    assert.ok(closeDescriptor)
    await probeHandle.close()
    fs.promises.open = async (...args) => {
      const fileHandle = await originalOpen(...args)
      const handleCloseDescriptor = Object.getOwnPropertyDescriptor(fileHandle, "close")
      assert.ok(handleCloseDescriptor)
      const originalClose = handleCloseDescriptor.value
      Object.defineProperty(fileHandle, "close", {
        ...handleCloseDescriptor,
        value: async function injectedCloseFailure(...closeArgs) {
          await originalClose.apply(this, closeArgs)
          throw new Error("injected close failure")
        },
      })
      return fileHandle
    }
    syncBuiltinESMExports()
    openPatched = true

    await assert.rejects(readMode0600JsonFile(validPath, "mode error"), {
      message: "injected close failure",
    })
    await assert.rejects(readMode0600JsonFile(malformedPath, "mode error"), SyntaxError)
  } finally {
    if (openPatched) {
      fs.promises.open = originalOpen
      syncBuiltinESMExports()
    }
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime receipts are mode 0600, current-run scoped, and stale receipts fail stopped checks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-current",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
      }),
    )
    assert.equal((await stat(receiptPath)).mode & 0o777, 0o600)
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        runId: "stale-run",
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        portChecker: async () => true,
      }),
      /stale/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime and zero-resource receipts reject extra fields, missing fields, and unsafe modes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    const zeroResourcesPath = path.join(dir, "zero.json")
    await writeRuntimeReceipt(receiptPath, {
      ...createRuntimeReceipt({
        runId: "run-strict",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
      }),
      unexpected: true,
    })
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        zeroResourcesPath,
        resourceScanner: async () => {
          throw new Error("Docker unavailable")
        },
        portChecker: async () => true,
      }),
      /exact runtime receipt schema/i,
    )
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-strict",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
      }),
    )
    await writeFile(
      zeroResourcesPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-strict",
        containers: 0,
        volumes: 0,
        networks: 0,
        portsFree: true,
      }),
      { mode: 0o644 },
    )
    await chmod(zeroResourcesPath, 0o644)
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        zeroResourcesPath,
        resourceScanner: async () => {
          throw new Error("Docker unavailable")
        },
        portChecker: async () => true,
      }),
      /zero-resource receipt must be mode 0600/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime receipt rejects a final-component symbolic link with the runtime mode error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const targetPath = path.join(dir, "runtime-target.json")
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(
      targetPath,
      createRuntimeReceipt({
        runId: "run-runtime-symlink",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
      }),
    )
    await symlink(targetPath, receiptPath)
    let scannerCalls = 0
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        resourceScanner: async () => {
          scannerCalls += 1
          return { containers: [], volumes: [], networks: [] }
        },
        portChecker: async () => true,
      }),
      { message: "Runtime receipt must be mode 0600" },
    )
    assert.equal(scannerCalls, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("zero-resource receipt rejects a final-component symbolic link with the zero-resource mode error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    const targetPath = path.join(dir, "zero-target.json")
    const zeroResourcesPath = path.join(dir, "zero.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-zero-symlink",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
      }),
    )
    await writeFile(
      targetPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-zero-symlink",
        containers: 0,
        volumes: 0,
        networks: 0,
        portsFree: true,
      }),
      { mode: 0o600 },
    )
    await chmod(targetPath, 0o600)
    await symlink(targetPath, zeroResourcesPath)
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        zeroResourcesPath,
        resourceScanner: async () => {
          throw new Error("Docker unavailable")
        },
        portChecker: async () => true,
      }),
      { message: "Zero-resource receipt must be mode 0600" },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("runtime receipt rejects a mode-0600 final-component directory with the runtime mode error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    await mkdir(receiptPath, { mode: 0o600 })
    await chmod(receiptPath, 0o600)
    let scannerCalls = 0
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        resourceScanner: async () => {
          scannerCalls += 1
          return { containers: [], volumes: [], networks: [] }
        },
        portChecker: async () => true,
      }),
      { message: "Runtime receipt must be mode 0600" },
    )
    assert.equal(scannerCalls, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("zero-resource receipt rejects a mode-0600 final-component directory with the zero-resource mode error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    const zeroResourcesPath = path.join(dir, "zero.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-zero-directory",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
      }),
    )
    await mkdir(zeroResourcesPath, { mode: 0o600 })
    await chmod(zeroResourcesPath, 0o600)
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        zeroResourcesPath,
        resourceScanner: async () => {
          throw new Error("Docker unavailable")
        },
        portChecker: async () => true,
      }),
      { message: "Zero-resource receipt must be mode 0600" },
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("receipt arrays require valid element ranges and uniqueness", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    await writeRuntimeReceipt(receiptPath, {
      ...createRuntimeReceipt({
        runId: "run-invalid",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
      }),
      selectedNextPorts: ["3006"],
      ownedPids: [-1],
    })
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        portChecker: async () => true,
      }),
      /integer ports|process ids/i,
    )
    await writeRuntimeReceipt(receiptPath, {
      ...createRuntimeReceipt({
        runId: "run-invalid",
        createdAt: new Date().toISOString(),
        dockerOwnership: "preexisting",
      }),
      supabasePorts: SUPABASE_PORTS,
      selectedNextPorts: [0, 65_536],
      ownedPids: [123, 123],
    })
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        resourceScanner: async () => ({ containers: [], volumes: [], networks: [] }),
        portChecker: async () => true,
      }),
      /integer ports|duplicate/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("active resources never fall back to a prior zero-resource receipt", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-guard-"))
  try {
    const receiptPath = path.join(dir, "runtime.json")
    const zeroResourcesPath = path.join(dir, "zero.json")
    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-active",
        createdAt: new Date().toISOString(),
        dockerOwnership: "task-installed",
      }),
    )
    await writeFile(
      zeroResourcesPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-active",
        containers: 0,
        volumes: 0,
        networks: 0,
        portsFree: true,
      }),
      { mode: 0o600 },
    )
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        zeroResourcesPath,
        resourceScanner: async () => ({
          containers: ["supabase_db_spolink"],
          volumes: [],
          networks: [],
        }),
        portChecker: async () => true,
      }),
      /containers still exist/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
