import { spawn } from "node:child_process"
import { chmod, lstat, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

import {
  computeTask3SourceBinding,
  parseTask3Binding,
  resolveTask3AggregateEnvironment,
  Task3EvidenceError,
} from "./task3-evidence.mjs"
import {
  assertTask3PrivateTree,
  snapshotTask3PrivateTree,
  writeTask3PrivateJson,
} from "./task3-private-tree.mjs"

const indexName = "task-7-current-attempt-index.json"
const hygieneName = "task-7-evidence-hygiene.json"
const replayContractName = "task-3-supabase-replay-contract.json"
const remediationRelative = ".omo/evidence/high-priority-missing-services/task-3/remediation"

export async function runTask3SupabaseReceipt(options) {
  const repoRoot = options.repoRoot ?? process.cwd()
  const attemptRoot = await resolveAttempt(options.attempt, repoRoot)
  await assertTask3PrivateTree(attemptRoot)
  const seal = await readSealState(attemptRoot)
  if (seal === "incomplete") throw new Task3EvidenceError("Task 3 attempt seal is incomplete")
  if (seal === "unsealed") {
    const outputDir = path.join(attemptRoot, "supabase-aggregate-outputs")
    await runAggregate(options.runAggregate, repoRoot, attemptRoot, outputDir)
    const contract = await collectReplayContract(attemptRoot, outputDir, repoRoot)
    await writeTask3PrivateJson(path.join(attemptRoot, replayContractName), contract)
    return { counts: contract.counts, mode: "generation" }
  }

  const manifest = JSON.parse(await readFile(path.join(attemptRoot, indexName), "utf8"))
  const { verifyTask3AttemptEvidence } = await import("./verify-task3-attempt-evidence.mjs")
  await verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot)
  const expected = await readReplayContract(attemptRoot)
  const before = await snapshotTask3PrivateTree(attemptRoot)
  const replayRoot = await createReplayRoot(attemptRoot, repoRoot)
  try {
    const outputDir = path.join(replayRoot, "supabase-aggregate-outputs")
    await runAggregate(options.runAggregate, repoRoot, replayRoot, outputDir)
    const observed = await collectReplayContract(replayRoot, outputDir, repoRoot)
    if (!isDeepStrictEqual(observed, expected)) {
      throw new Task3EvidenceError("Sealed Supabase replay contract does not match the receipt")
    }
  } finally {
    await rm(replayRoot, { force: true, recursive: true })
  }
  await verifyTask3AttemptEvidence({ attemptRoot, manifest }, repoRoot)
  if (!isDeepStrictEqual(await snapshotTask3PrivateTree(attemptRoot), before)) {
    throw new Task3EvidenceError("Sealed Task 3 attempt changed during receipt replay")
  }
  return { counts: expected.counts, mode: "sealed-replay" }
}

async function resolveAttempt(input, repoRoot) {
  if (typeof input !== "string") throw new Task3EvidenceError("Receipt attempt is required")
  const attemptRoot = path.resolve(repoRoot, input)
  const outputRelative = `${path.relative(repoRoot, attemptRoot).split(path.sep).join("/")}/supabase-aggregate-outputs`
  const resolved = await resolveTask3AggregateEnvironment({
    attemptRoot: input,
    outputDir: outputRelative,
    repoRoot,
  })
  return resolved.attemptRoot
}

async function readSealState(attemptRoot) {
  const states = await Promise.all(
    [indexName, hygieneName].map(async (name) => {
      try {
        const stats = await lstat(path.join(attemptRoot, name))
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Task3EvidenceError("Task 3 seal files must be regular files")
        }
        return true
      } catch (error) {
        if (error?.code === "ENOENT") return false
        throw error
      }
    }),
  )
  if (states[0] !== states[1]) return "incomplete"
  return states[0] ? "sealed" : "unsealed"
}

async function createReplayRoot(sealedRoot, repoRoot) {
  const remediation = path.join(repoRoot, remediationRelative)
  const replayRoot = await mkdtemp(path.join(remediation, "attempt-replay-"))
  await chmod(replayRoot, 0o700)
  const binding = parseTask3Binding(
    JSON.parse(await readFile(path.join(sealedRoot, "task-3-binding.json"), "utf8")),
  )
  await writeTask3PrivateJson(path.join(replayRoot, "task-3-binding.json"), {
    ...binding,
    attemptId: path.basename(replayRoot),
    capturedAt: new Date().toISOString(),
  })
  await assertTask3PrivateTree(replayRoot)
  return replayRoot
}

async function runAggregate(injected, repoRoot, attemptRoot, outputDir) {
  const runner = injected ?? executeAggregate
  const result = await runner({
    attemptRoot,
    attemptRelative: path.relative(repoRoot, attemptRoot).split(path.sep).join("/"),
    outputDir,
    outputRelative: path.relative(repoRoot, outputDir).split(path.sep).join("/"),
    repoRoot,
  })
  if (result.exitCode !== 0) throw new Task3EvidenceError("Supabase aggregate command failed")
}

async function executeAggregate(context) {
  const env = { ...process.env }
  for (const key of [
    "SPOLINK_E2E_FORCE_LOCK_TIMEOUT",
    "SPOLINK_E2E_INJECT_FAILURE",
    "SPOLINK_E2E_QA_HOLD_SECONDS",
    "SPOLINK_E2E_QA_METADATA",
  ])
    delete env[key]
  env.SPOLINK_TASK3_ATTEMPT_DIR = context.attemptRelative
  env.SPOLINK_E2E_OUTPUT_DIR = context.outputRelative
  env.SPOLINK_E2E_EVIDENCE_LOG = `${context.outputRelative}/run-evidence.jsonl`
  env.SPOLINK_E2E_QA_OUTPUT_DIR = `${context.outputRelative}/qa`
  return new Promise((resolve, reject) => {
    const child = spawn("corepack", ["pnpm", "test:e2e:supabase"], {
      cwd: context.repoRoot,
      env,
      shell: false,
      stdio: "inherit",
    })
    const forward = (signal) => child.kill(signal)
    process.once("SIGINT", forward)
    process.once("SIGTERM", forward)
    child.once("error", reject)
    child.once("close", (code, signal) => {
      process.removeListener("SIGINT", forward)
      process.removeListener("SIGTERM", forward)
      resolve({ exitCode: code ?? (signal ? 128 : 1) })
    })
  })
}

async function collectReplayContract(attemptRoot, outputDir, repoRoot) {
  await assertTask3PrivateTree(attemptRoot)
  const focused = JSON.parse(
    await readFile(path.join(attemptRoot, "focused-reservation-lifecycle.json"), "utf8"),
  )
  const races = JSON.parse(await readFile(path.join(attemptRoot, "task-5-db-races.json"), "utf8"))
  const captured = JSON.parse(
    await readFile(path.join(outputDir, "reservation-lifecycle-api.test.mjs.json"), "utf8"),
  )
  const marker = captured.stdout?.split("\n").find((line) => line.startsWith("TASK4_HTTP_SUMMARY "))
  if (captured.exitCode !== 0 || !marker) {
    throw new Task3EvidenceError("Supabase replay HTTP evidence is missing")
  }
  const http = JSON.parse(marker.slice("TASK4_HTTP_SUMMARY ".length))
  const summaries = (await readdir(outputDir)).filter(
    (name) => name.startsWith("integrated-summary-") && name.endsWith(".json"),
  )
  if (summaries.length !== 1) throw new Task3EvidenceError("Supabase replay summary is ambiguous")
  const aggregate = JSON.parse(await readFile(path.join(outputDir, summaries[0]), "utf8"))
  const rejected = http.cases.filter((entry) => entry.type === "rejected")
  const counts = {
    aggregateSuites: 9,
    httpCases: http.cases.length,
    httpRejected: rejected.length,
    httpReplayed: http.cases.filter((entry) => entry.type === "replay").length,
    httpRollbackFailures: rejected.filter((entry) => entry.rollbackEquivalent !== true).length,
    httpSucceeded: http.cases.filter((entry) => entry.type === "success").length,
    lifecycleObservations: focused.observations.length,
    pendingRaceWorkers: races.races.filter((entry) => entry.pendingWorkers !== 0).length,
    races: races.races.length,
  }
  const expected = expectedCounts()
  if (
    !isDeepStrictEqual(counts, expected) ||
    http.cases.some((entry) => entry.noStore !== true) ||
    focused.verdict !== "focused-pass" ||
    races.verdict !== "passed" ||
    aggregate.status !== "success"
  )
    throw new Task3EvidenceError("Supabase replay required counts or contracts failed")
  const binding = parseTask3Binding(
    JSON.parse(await readFile(path.join(attemptRoot, "task-3-binding.json"), "utf8")),
  )
  const currentSource = await computeTask3SourceBinding(repoRoot)
  if (
    binding.head !== currentSource.head ||
    binding.sourceManifestSha256 !== currentSource.manifestSha256 ||
    binding.worktreeStatusSha256 !== currentSource.statusSha256
  )
    throw new Task3EvidenceError("Supabase replay source binding changed during execution")
  return {
    counts,
    recordType: "task-3-supabase-replay-contract",
    schemaVersion: 1,
    source: {
      head: binding.head,
      manifestSha256: binding.sourceManifestSha256,
      statusSha256: binding.worktreeStatusSha256,
    },
  }
}

async function readReplayContract(attemptRoot) {
  const contract = JSON.parse(await readFile(path.join(attemptRoot, replayContractName), "utf8"))
  if (
    contract.recordType !== "task-3-supabase-replay-contract" ||
    contract.schemaVersion !== 1 ||
    !isDeepStrictEqual(contract.counts, expectedCounts())
  )
    throw new Task3EvidenceError("Sealed Supabase replay contract is invalid")
  return contract
}

function expectedCounts() {
  return {
    aggregateSuites: 9,
    httpCases: 36,
    httpRejected: 30,
    httpReplayed: 3,
    httpRollbackFailures: 0,
    httpSucceeded: 3,
    lifecycleObservations: 2,
    pendingRaceWorkers: 0,
    races: 7,
  }
}
