import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open, readdir, realpath, rm, rmdir } from "node:fs/promises"
import path from "node:path"

const diagnosisKeys = [
  "document",
  "event",
  "headingMatched",
  "inflightPath",
  "lastFailedPath",
  "phases",
  "profileMatched",
  "project",
]
const diagnosisPhaseNames = [
  "3 Auth sessions",
  "cleanup/seed",
  "learner activation",
  "/mypage document request/response",
  "SSR profile/read model/heading",
  "nav/filter/detail",
  "cleanup",
]
const maximumPhaseDurationMs = 60_000

export function validateExpectedPlaywrightEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Expected Playwright output entries are required")
  }
  const expected = new Map()
  for (const entry of entries) {
    if (
      !entry ||
      !/^[.a-z0-9][a-z0-9._-]*$/iu.test(entry.name) ||
      entry.name === "." ||
      entry.name === ".."
    ) {
      throw new Error("Expected Playwright output name is invalid")
    }
    if (expected.has(entry.name)) throw new Error("Expected Playwright output name is duplicated")
    if (entry.kind !== "last-run" && entry.kind !== "diagnosis") {
      throw new Error("Expected Playwright output kind is invalid")
    }
    if (entry.kind === "diagnosis" && !/^[a-z0-9-]+$/u.test(entry.project ?? "")) {
      throw new Error("Expected Playwright project is invalid")
    }
    expected.set(entry.name, Object.freeze({ ...entry }))
  }
  return expected
}

export async function removeValidatedPlaywrightOutput({ directory, expected }) {
  let outputIdentity
  try {
    outputIdentity = (await readOwnedEntry(directory, "directory", [0o700, 0o755])).identity
  } catch (error) {
    if (error?.code === "ENOENT") return
    throw error
  }
  if ((await realpath(directory)) !== directory) {
    throw new Error("Playwright output realpath changed")
  }
  const names = (await readdir(directory)).sort()
  const expectedNames = [...expected.keys()].sort()
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error("Playwright output contains unregistered inventory")
  }

  const entries = []
  for (const name of names) {
    const candidate = path.join(directory, name)
    const descriptor = expected.get(name)
    const modes = descriptor.kind === "last-run" ? [0o600, 0o644] : [0o600]
    const { bytes, identity } = await readOwnedEntry(candidate, "file", modes)
    validateJson(bytes, descriptor)
    entries.push({ bytesHash: hash(bytes), candidate, identity, modes })
  }

  await assertDirectoryIdentity(directory, outputIdentity)
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expectedNames)) {
    throw new Error("Playwright output inventory changed before cleanup")
  }
  for (const entry of entries) {
    const current = await readOwnedEntry(entry.candidate, "file", entry.modes)
    assertIdentity(current.identity, entry.identity, "Playwright output entry")
    if (hash(current.bytes) !== entry.bytesHash) {
      throw new Error("Playwright output entry bytes changed before cleanup")
    }
  }

  for (const entry of entries) await rm(entry.candidate)
  await rmdir(directory)
  return { validatedEntries: expectedNames }
}

async function assertDirectoryIdentity(directory, expected) {
  const current = (await readOwnedEntry(directory, "directory", [expected.mode & 0o777])).identity
  assertIdentity(current, expected, "Playwright output directory")
  if (current.nlink !== expected.nlink) {
    throw new Error("Playwright output directory topology changed")
  }
}

async function readOwnedEntry(candidate, expectedType, expectedModes) {
  let handle
  try {
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    const before = await handle.stat()
    const matchesType = expectedType === "file" ? before.isFile() : before.isDirectory()
    if (
      !matchesType ||
      before.uid !== process.getuid() ||
      !expectedModes.includes(before.mode & 0o777) ||
      (expectedType === "file" && before.nlink !== 1)
    ) {
      throw new Error(`Playwright output ${expectedType} ownership changed`)
    }
    const bytes = expectedType === "file" ? await handle.readFile() : null
    const after = await handle.stat()
    const identity = { dev: after.dev, ino: after.ino, mode: after.mode, nlink: after.nlink }
    assertIdentity(identity, before, `Playwright output ${expectedType}`)
    if (after.mode !== before.mode || after.nlink !== before.nlink) {
      throw new Error(`Playwright output ${expectedType} ownership changed`)
    }
    return { bytes, identity }
  } catch (error) {
    if (error?.code === "ELOOP") {
      throw new Error(`Playwright output ${expectedType} ownership changed`)
    }
    throw error
  } finally {
    await handle?.close()
  }
}

function assertIdentity(current, expected, label) {
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`${label} identity changed`)
  }
}

function validateJson(bytes, descriptor) {
  let value
  try {
    value = JSON.parse(bytes.toString("utf8"))
  } catch {
    throw new Error("Playwright output JSON is invalid")
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Playwright output JSON schema is invalid")
  }
  if (descriptor.kind === "last-run") {
    if (
      !["passed", "failed"].includes(value.status) ||
      !Array.isArray(value.failedTests) ||
      !value.failedTests.every((item) => typeof item === "string")
    ) {
      throw new Error("Playwright last-run JSON schema is invalid")
    }
    return
  }
  validateDiagnosis(value, descriptor.project)
}

function validateDiagnosis(value, project) {
  if (!hasExactKeys(value, diagnosisKeys)) {
    throw new Error("Playwright diagnosis fields are invalid")
  }
  if (
    value.event !== "task3-browser-diagnosis" ||
    value.project !== project ||
    value.headingMatched !== true ||
    value.profileMatched !== true
  ) {
    throw new Error("Playwright diagnosis project or final state is invalid")
  }
  if (value.inflightPath !== null || value.lastFailedPath !== null) {
    throw new Error("Playwright diagnosis request state is invalid")
  }
  if (
    !isRecord(value.document) ||
    !hasExactKeys(value.document, ["finished", "status"]) ||
    value.document.finished !== true ||
    value.document.status !== 200
  ) {
    throw new Error("Playwright diagnosis /mypage document state is invalid")
  }
  if (
    !Array.isArray(value.phases) ||
    value.phases.length !== diagnosisPhaseNames.length ||
    !value.phases.every((phase, index) => validPhase(phase, diagnosisPhaseNames[index]))
  ) {
    throw new Error("Playwright diagnosis phase verdict or duration is invalid")
  }
}

function validPhase(phase, expectedName) {
  return (
    isRecord(phase) &&
    hasExactKeys(phase, ["durationMs", "name", "status"]) &&
    phase.name === expectedName &&
    phase.status === "passed" &&
    Number.isSafeInteger(phase.durationMs) &&
    phase.durationMs >= 0 &&
    phase.durationMs <= maximumPhaseDurationMs
  )
}

function hasExactKeys(value, expected) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
  )
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}
