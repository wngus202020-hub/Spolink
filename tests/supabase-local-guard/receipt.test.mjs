import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  assertStoppedState,
  createRuntimeReceipt,
  SUPABASE_PORTS,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"

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
