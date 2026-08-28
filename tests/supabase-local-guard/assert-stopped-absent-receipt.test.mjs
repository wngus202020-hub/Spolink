import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  assertStoppedState,
  createRuntimeReceipt,
  runtimeLockPath,
  SUPABASE_PORTS,
  writeRuntimeReceipt,
} from "../../scripts/supabase-local.mjs"

const emptyResources = () => ({ containers: [], volumes: [], networks: [] })

test("assert-stopped accepts a clean absent canonical runtime receipt without mutation", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-absent-receipt-"))
  const receiptPath = path.join(repoRoot, ".omo", "evidence", "runtime.json")
  const observedPorts = []
  try {
    const result = await assertStoppedState({
      receiptPath,
      repoRoot,
      resourceScanner: async () => emptyResources(),
      portChecker: async (ports) => {
        observedPorts.push(...ports)
        return true
      },
    })

    assert.deepEqual(result, { portsFree: true, resources: emptyResources() })
    assert.deepEqual(
      observedPorts,
      [3000, ...SUPABASE_PORTS].sort((left, right) => left - right),
    )
    assert.deepEqual(await readdir(repoRoot), [])
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
})

test("assert-stopped never treats an invalid present receipt as absence", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-invalid-receipt-"))
  const receiptPath = path.join(repoRoot, "runtime.json")
  let scans = 0
  const assertPresentReceiptRejected = async (expected) => {
    await assert.rejects(
      assertStoppedState({
        receiptPath,
        repoRoot,
        resourceScanner: async () => {
          scans += 1
          return emptyResources()
        },
        portChecker: async () => true,
      }),
      expected,
    )
    assert.equal(scans, 0)
  }

  try {
    await writeFile(receiptPath, "{", { mode: 0o600 })
    await assertPresentReceiptRejected(/JSON/i)

    await writeRuntimeReceipt(
      receiptPath,
      createRuntimeReceipt({
        runId: "run-stale",
        createdAt: "2000-01-01T00:00:00.000Z",
        dockerOwnership: "preexisting",
      }),
    )
    await assertPresentReceiptRejected(/stale/i)

    await chmod(receiptPath, 0o644)
    await assertPresentReceiptRejected(/mode 0600/i)

    await writeRuntimeReceipt(receiptPath, {
      ...createRuntimeReceipt({
        runId: "run-broadened",
        dockerOwnership: "preexisting",
      }),
      resourceSelectors: { namePattern: ".*", label: "" },
    })
    await assertPresentReceiptRejected(/resource selectors/i)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
})

test("assert-stopped absent-receipt proof fails closed for every dirty state dimension", async (t) => {
  const cases = [
    {
      name: "Docker unavailable",
      expected: /Docker unavailable/,
      resourceScanner: async () => {
        throw new Error("Docker unavailable")
      },
    },
    {
      name: "canonical resource remains",
      expected: /containers still exist/i,
      resourceScanner: async () => ({
        containers: ["supabase_db_spolink"],
        volumes: [],
        networks: [],
      }),
    },
    { name: "fixed port occupied", expected: /ports are still listening/i, portsFree: false },
    {
      name: "runtime directory remains",
      expected: /runtime directory still exists/i,
      runtimeDir: true,
    },
    { name: "lifecycle lock remains", expected: /lifecycle lock still exists/i, lock: true },
  ]

  for (const dirtyCase of cases) {
    await t.test(dirtyCase.name, async () => {
      const repoRoot = await mkdtemp(path.join(tmpdir(), "spolink-dirty-state-"))
      const receiptPath = path.join(repoRoot, ".omo", "evidence", "runtime.json")
      try {
        if (dirtyCase.runtimeDir) await mkdir(path.join(repoRoot, ".supabase"))
        if (dirtyCase.lock) {
          await mkdir(path.dirname(receiptPath), { recursive: true })
          await writeFile(runtimeLockPath(receiptPath), "occupied", { mode: 0o600 })
        }
        await assert.rejects(
          assertStoppedState({
            receiptPath,
            repoRoot,
            resourceScanner: dirtyCase.resourceScanner ?? (async () => emptyResources()),
            portChecker: async () => dirtyCase.portsFree ?? true,
          }),
          dirtyCase.expected,
        )
      } finally {
        await rm(repoRoot, { recursive: true, force: true })
      }
    })
  }
})
