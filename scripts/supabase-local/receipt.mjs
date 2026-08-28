import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { writeRedactedJson } from "../../tests/supabase-e2e/evidence-redaction.mjs"
import {
  PROJECT_LABEL,
  PROJECT_RESOURCE_PATTERN_TEXT,
  RECEIPT_MAX_AGE_MS,
  RUNTIME_DIRS,
  RUNTIME_RECEIPT_PATH,
  SUPABASE_PORTS,
} from "./constants.mjs"
import {
  absoluteEvidencePath,
  assertExactKeys,
  readMode0600JsonFile,
  sameNumberArray,
} from "./utils.mjs"

export function createRuntimeReceipt({
  runId,
  createdAt = new Date().toISOString(),
  dockerOwnership,
  selectedNextPorts = [],
  ownedPids = [],
  ownedRuntimeDirs = { runId, paths: [] },
  dockerOwnershipProof = null,
}) {
  if (!["preexisting", "task-started", "task-installed"].includes(dockerOwnership)) {
    throw new Error("Invalid docker ownership")
  }
  return {
    schemaVersion: 1,
    runId,
    createdAt,
    dockerOwnership,
    dockerOwnershipProof,
    supabasePorts: SUPABASE_PORTS,
    selectedNextPorts,
    ownedPids,
    ownedRuntimeDirs,
    resourceSelectors: { namePattern: PROJECT_RESOURCE_PATTERN_TEXT, label: PROJECT_LABEL },
  }
}

export async function writeRuntimeReceipt(receiptPath, receipt) {
  await mkdir(path.dirname(receiptPath), { recursive: true })
  await writeRedactedJson(receiptPath, receipt, [])
}

export async function readRuntimeReceipt(receiptPath) {
  const receipt = await readMode0600JsonFile(receiptPath, "Runtime receipt must be mode 0600")
  assertReceiptShape(receipt)
  assertReceiptFresh(receipt)
  return receipt
}

export async function maybeReadRuntimeReceipt(receiptPath) {
  try {
    return await readRuntimeReceipt(receiptPath)
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null
    }
    throw error
  }
}

export async function requireCurrentRuntimeReceipt({
  receiptPath = absoluteEvidencePath(RUNTIME_RECEIPT_PATH),
  runId,
}) {
  const receipt = await readRuntimeReceipt(receiptPath)
  if (runId && receipt.runId !== runId) {
    throw new Error("Stale runtime receipt runId")
  }
  return receipt
}

export function assertNextOwnershipVacant(receipt, runId) {
  if (receipt.runId !== runId) throw new Error("Stale runtime receipt runId")
  if (receipt.ownedPids.length !== 0 || receipt.selectedNextPorts.length !== 0)
    throw new Error("Runtime receipt already owns a Next child")
}

export function registerNextOwnership(receipt, { runId, pid, port }) {
  assertNextOwnershipVacant(receipt, runId)
  if (!Number.isInteger(pid) || pid <= 0 || port !== 3000)
    throw new Error("Invalid fixed-port Next ownership")
  return { ...receipt, ownedPids: [pid], selectedNextPorts: [port] }
}

export function unregisterNextOwnership(receipt, { runId, pid, port }) {
  const hasMismatch =
    receipt.runId !== runId ||
    !sameNumberArray(receipt.ownedPids, [pid]) ||
    !sameNumberArray(receipt.selectedNextPorts, [port])
  if (hasMismatch) throw new Error("Next child ownership mismatch")
  return { ...receipt, ownedPids: [], selectedNextPorts: [] }
}

export async function removeOwnedRuntimeDirs(repoRoot, receipt) {
  assertOwnedRuntimeDirs(receipt)
  for (const rel of receipt.ownedRuntimeDirs.paths) {
    if (!RUNTIME_DIRS.includes(rel)) {
      throw new Error(`Unexpected owned runtime dir: ${rel}`)
    }
    await rm(path.join(repoRoot, rel), { recursive: true, force: true })
  }
}

function assertReceiptShape(receipt) {
  assertExactKeys(
    receipt,
    [
      "createdAt",
      "dockerOwnership",
      "dockerOwnershipProof",
      "ownedPids",
      "ownedRuntimeDirs",
      "resourceSelectors",
      "runId",
      "schemaVersion",
      "selectedNextPorts",
      "supabasePorts",
    ],
    "runtime receipt",
  )
  if (receipt.schemaVersion !== 1 || typeof receipt.runId !== "string" || !receipt.runId)
    throw new Error("Invalid runtime receipt")
  if (!["preexisting", "task-started", "task-installed"].includes(receipt.dockerOwnership)) {
    throw new Error("Invalid runtime receipt dockerOwnership")
  }
  if (!sameNumberArray(receipt.supabasePorts, SUPABASE_PORTS)) {
    throw new Error("Invalid runtime receipt Supabase port list")
  }
  assertRuntimeArrays(receipt)
  assertOwnedRuntimeDirs(receipt)
  assertExactKeys(receipt.resourceSelectors, ["label", "namePattern"], "runtime receipt selectors")
  if (
    receipt.resourceSelectors.namePattern !== PROJECT_RESOURCE_PATTERN_TEXT ||
    receipt.resourceSelectors.label !== PROJECT_LABEL
  ) {
    throw new Error("Invalid runtime receipt resource selectors")
  }
}

function assertRuntimeArrays(receipt) {
  if (!Array.isArray(receipt.selectedNextPorts) || !Array.isArray(receipt.ownedPids)) {
    throw new Error("Invalid runtime receipt Next ownership lists")
  }
  if (
    !receipt.selectedNextPorts.every(
      (port) => Number.isInteger(port) && port >= 1 && port <= 65_535,
    )
  ) {
    throw new Error("Runtime receipt selectedNextPorts must contain integer ports")
  }
  if (!receipt.ownedPids.every((pid) => Number.isInteger(pid) && pid > 0)) {
    throw new Error("Runtime receipt ownedPids must contain positive process ids")
  }
  if (
    new Set(receipt.supabasePorts).size !== receipt.supabasePorts.length ||
    new Set(receipt.selectedNextPorts).size !== receipt.selectedNextPorts.length ||
    new Set(receipt.ownedPids).size !== receipt.ownedPids.length
  ) {
    throw new Error("Runtime receipt contains duplicate ports or PIDs")
  }
}

function assertOwnedRuntimeDirs(receipt) {
  assertExactKeys(receipt.ownedRuntimeDirs, ["paths", "runId"], "runtime directory ownership")
  if (receipt.ownedRuntimeDirs.runId !== receipt.runId) {
    throw new Error("Runtime directory ownership runId does not match receipt")
  }
  if (!Array.isArray(receipt.ownedRuntimeDirs.paths))
    throw new Error("Runtime directory ownership paths must be an array")
}

function assertReceiptFresh(receipt) {
  const createdAt = Date.parse(receipt.createdAt)
  const age = Date.now() - createdAt
  if (!Number.isFinite(createdAt) || age < -300_000 || age > RECEIPT_MAX_AGE_MS) {
    throw new Error("Stale runtime receipt createdAt")
  }
}
