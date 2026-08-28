import { lstat } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import process from "node:process"

import {
  RUNTIME_DIRS,
  RUNTIME_RECEIPT_PATH,
  SUPABASE_PORTS,
  ZERO_RESOURCES_PATH,
} from "./constants.mjs"
import { assertZeroResources, scanProjectResources } from "./docker.mjs"
import { runtimeLockPath } from "./lock.mjs"
import { readRuntimeReceipt } from "./receipt.mjs"
import {
  absoluteEvidencePath,
  assertExactKeys,
  readMode0600JsonFile,
  siblingEvidencePath,
  uniqueNumbers,
} from "./utils.mjs"

export async function assertStoppedState({
  receiptPath = absoluteEvidencePath(RUNTIME_RECEIPT_PATH),
  repoRoot = process.cwd(),
  zeroResourcesPath,
  runId,
  dockerOwnership,
  resourceScanner = scanProjectResources,
  portChecker = arePortsFree,
}) {
  let receipt
  try {
    receipt = await readRuntimeReceipt(receiptPath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error

    const ports = uniqueNumbers([3000, ...SUPABASE_PORTS])
    if (!(await portChecker(ports))) {
      throw new Error(`Ports are still listening: ${ports.join(",")}`)
    }
    const resources = await resourceScanner()
    assertZeroResources(resources)
    const absentPaths = [
      ...RUNTIME_DIRS.map((rel) => [path.join(repoRoot, rel), "Runtime directory still exists"]),
      [runtimeLockPath(receiptPath), "Supabase lifecycle lock still exists"],
    ]
    for (const [candidate, message] of absentPaths) {
      try {
        await lstat(candidate)
        throw new Error(`${message}: ${candidate}`)
      } catch (pathError) {
        if (pathError?.code !== "ENOENT") throw pathError
      }
    }
    return { portsFree: true, resources }
  }
  if (runId && receipt.runId !== runId) {
    throw new Error("Stale runtime receipt runId")
  }
  await assertRuntimeDirsAbsent(repoRoot, receipt.ownedRuntimeDirs.paths)
  const ownership = dockerOwnership ?? receipt.dockerOwnership
  const ports = uniqueNumbers([...receipt.supabasePorts, ...receipt.selectedNextPorts])
  if (!(await portChecker(ports))) {
    throw new Error(`Ports are still listening: ${ports.join(",")}`)
  }
  let resources
  try {
    resources = await resourceScanner()
  } catch (error) {
    if (!["task-started", "task-installed"].includes(ownership)) {
      throw error
    }
    await assertZeroResourceReceipt(
      zeroResourcesPath ?? zeroResourcePathForReceipt(receiptPath),
      receipt,
    )
    return { portsFree: true, resources: { containers: [], volumes: [], networks: [] } }
  }
  assertZeroResources(resources)
  return { portsFree: true, resources }
}

async function assertRuntimeDirsAbsent(repoRoot, relativePaths) {
  for (const relativePath of relativePaths) {
    const candidate = path.join(repoRoot, relativePath)
    try {
      await lstat(candidate)
      throw new Error(`Runtime directory still exists: ${candidate}`)
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
}

export function zeroResourcePathForReceipt(receiptPath) {
  return siblingEvidencePath(receiptPath, ZERO_RESOURCES_PATH)
}

async function assertZeroResourceReceipt(zeroResourcesPath, receipt) {
  const zeroReceipt = await readMode0600JsonFile(
    zeroResourcesPath,
    "Zero-resource receipt must be mode 0600",
  )
  assertExactKeys(
    zeroReceipt,
    ["containers", "networks", "portsFree", "runId", "schemaVersion", "volumes"],
    "zero-resource receipt",
  )
  if (
    zeroReceipt.schemaVersion !== 1 ||
    zeroReceipt.runId !== receipt.runId ||
    zeroReceipt.containers !== 0 ||
    zeroReceipt.volumes !== 0 ||
    zeroReceipt.networks !== 0 ||
    zeroReceipt.portsFree !== true
  ) {
    throw new Error("Task-owned Docker unavailable without matching zero-resource receipt")
  }
}

async function arePortsFree(ports) {
  for (const port of ports) {
    if (!(await isPortFree(port))) {
      return false
    }
  }
  return true
}

async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}
