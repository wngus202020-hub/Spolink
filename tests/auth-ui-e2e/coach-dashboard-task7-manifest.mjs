import { chmod, lstat, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { readCoachDashboardEvidence } from "./coach-dashboard-evidence.mjs"
import { sha256 } from "./process.mjs"

const scenarioNames = ["populated-navigation", "redirect-ownership"]
const manifestName = "task-7-coach-dashboard-screen.json"

export async function updateCoachDashboardTask7Manifest({ root }) {
  const bindings = await collectScenarioBindings(root)
  if (!bindings) return null
  const payload = {
    schemaVersion: 2,
    scenarios: bindings,
    verdict: Object.values(bindings).every(bindingApproved) ? "APPROVE" : "REJECT",
  }
  const manifest = {
    ...payload,
    selfHash: {
      algorithm: "sha256",
      scope: "canonical JSON payload before selfHash insertion",
      value: sha256(JSON.stringify(payload)),
    },
  }
  await atomicWriteManifest(path.join(root, manifestName), manifest)
  return manifest
}

export async function readCoachDashboardTask7Manifest({ root }) {
  const manifestPath = path.join(root, manifestName)
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"))
  const { selfHash, ...payload } = parsed
  if (
    selfHash?.algorithm !== "sha256" ||
    selfHash?.scope !== "canonical JSON payload before selfHash insertion" ||
    selfHash?.value !== sha256(JSON.stringify(payload))
  ) {
    throw new Error("Coach dashboard task7 manifest self-hash mismatch")
  }
  if (((await stat(manifestPath)).mode & 0o777) !== 0o600) {
    throw new Error("Coach dashboard task7 manifest must be mode 0600")
  }
  const current = await collectScenarioBindings(root)
  if (!current || JSON.stringify(current) !== JSON.stringify(parsed.scenarios)) {
    throw new Error("Coach dashboard task7 manifest artifact binding mismatch")
  }
  const expectedVerdict = Object.values(current).every(bindingApproved) ? "APPROVE" : "REJECT"
  if (parsed.verdict !== expectedVerdict) {
    throw new Error("Coach dashboard task7 manifest verdict mismatch")
  }
  return parsed
}

async function collectScenarioBindings(root) {
  const entries = await Promise.all(
    scenarioNames.map(async (scenario) => {
      const summaryPath = path.join(root, `${scenario}.json`)
      if (!(await isFile(summaryPath))) return null
      const summary = await readCoachDashboardEvidence(summaryPath)
      const cleanupName = summary.lifecycleCleanupReceipt
      if (cleanupName !== `${scenario}.cleanup.json`) {
        throw new Error("Coach dashboard cleanup receipt name mismatch")
      }
      const cleanupPath = path.join(root, cleanupName)
      if (!(await isFile(cleanupPath))) return null
      const visual = summary.visuals?.files
      if (!Array.isArray(visual) || visual.length !== 1) {
        throw new Error("Coach dashboard task7 scenario must bind one PNG")
      }
      const visualEntry = visual[0]
      const visualPath = path.join(root, `${scenario}-visual`, visualEntry.name)
      const visualStats = await stat(visualPath)
      const visualHash = sha256(await readFile(visualPath))
      if (
        !visualStats.isFile() ||
        visualStats.size !== visualEntry.bytes ||
        visualHash !== visualEntry.sha256
      ) {
        throw new Error("Coach dashboard task7 visual binding mismatch")
      }
      return [
        scenario,
        {
          cleanup: summary.fixtureCleanup,
          cleanupReceipt: {
            name: cleanupName,
            sha256: sha256(await readFile(cleanupPath)),
          },
          exitCode: summary.exitCode,
          scenario: summary.scenario,
          summary: {
            name: `${scenario}.json`,
            selfHash: summary.selfHash.value,
            sha256: sha256(await readFile(summaryPath)),
          },
          verdict: summary.verdict,
          visual: {
            bytes: visualStats.size,
            name: visualEntry.name,
            sha256: visualHash,
          },
        },
      ]
    }),
  )
  if (entries.some((entry) => entry === null)) return null
  return Object.fromEntries(entries)
}

function bindingApproved(binding) {
  return (
    binding.exitCode === 0 &&
    binding.verdict === "APPROVE" &&
    binding.cleanup?.coachProfilesRemaining === 0 &&
    binding.cleanup?.graphRowsRemaining === 0 &&
    binding.cleanup?.profilesRemaining === 0 &&
    binding.cleanup?.usersRemaining === 0
  )
}

async function atomicWriteManifest(filePath, value) {
  await mkdir(path.dirname(filePath), { mode: 0o700, recursive: true })
  const existing = await optionalLstat(filePath)
  if (existing?.isSymbolicLink()) throw new Error("Coach dashboard task7 manifest symlink refused")
  const candidate = path.join(
    path.dirname(filePath),
    `.task7-manifest-${process.pid}-${Date.now()}.json`,
  )
  try {
    await writeFile(candidate, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    })
    await chmod(candidate, 0o600)
    await rename(candidate, filePath)
    await chmod(filePath, 0o600)
  } finally {
    await optionalUnlink(candidate)
  }
}

async function isFile(filePath) {
  const entry = await optionalLstat(filePath)
  return entry?.isFile() === true
}

async function optionalLstat(filePath) {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

async function optionalUnlink(filePath) {
  try {
    await unlink(filePath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}
