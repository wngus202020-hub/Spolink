import { chmod, readFile, stat } from "node:fs/promises"
import path from "node:path"

import { sha256, writeJsonMode600 } from "./process.mjs"

const hashScope = "canonical JSON payload before selfHash insertion"

export async function writeCoachDashboardTask8Reports({ root, summary }) {
  validateSummary(summary)
  const capturePayload = {
    schemaVersion: 1,
    cleanup: summary.fixtureCleanup,
    comparisons: summary.visuals.comparisons,
    captureCount: summary.visuals.files.length,
    files: summary.visuals.files,
    sourceBinding: summary.sourceBinding,
    verdict: "APPROVE",
  }
  const geometryPayload = {
    schemaVersion: 1,
    captureCount: summary.visualChecks.captureCount,
    projects: summary.visualChecks.projects,
    verdict: "APPROVE",
  }
  const capturePath = path.join(root, "capture-manifest.json")
  const geometryPath = path.join(root, "geometry-report.json")
  await Promise.all([
    writeHashedReport(capturePath, capturePayload),
    writeHashedReport(geometryPath, geometryPayload),
  ])
  return { capturePath, geometryPath }
}

export async function readCoachDashboardTask8Report(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"))
  const { selfHash, ...payload } = value
  if (
    selfHash?.algorithm !== "sha256" ||
    selfHash?.scope !== hashScope ||
    selfHash?.value !== sha256(JSON.stringify(payload))
  ) {
    throw new Error("Task8 report self-hash mismatch")
  }
  if (((await stat(filePath)).mode & 0o777) !== 0o600) {
    throw new Error("Task8 report must be mode 0600")
  }
  return value
}

async function writeHashedReport(filePath, payload) {
  const report = {
    ...payload,
    selfHash: {
      algorithm: "sha256",
      scope: hashScope,
      value: sha256(JSON.stringify(payload)),
    },
  }
  await writeJsonMode600(filePath, report)
  await chmod(filePath, 0o600)
}

function validateSummary(summary) {
  if (
    summary?.verdict !== "APPROVE" ||
    summary?.visuals?.verdict !== "APPROVE" ||
    summary?.visualChecks?.verdict !== "APPROVE" ||
    summary.visuals.files.length !== 14 ||
    summary.visualChecks.captureCount !== 14
  ) {
    throw new Error("Task8 reports require a complete approved fourteen-capture run")
  }
}
