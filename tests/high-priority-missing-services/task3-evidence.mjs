import { lstat, readFile, realpath } from "node:fs/promises"
import path from "node:path"

import { writeJsonMode600 } from "../auth-ui-e2e/process.mjs"
import {
  parseTask3Binding,
  requireTask3ExactKeys,
  Task3EvidenceError,
} from "./task3-evidence-validation.mjs"
import { computeTask3SourceBinding } from "./task3-source-binding.mjs"

export {
  isTask3IsoTimestamp,
  isTask3SafeAttemptId,
  isTask3SafeRelativePath,
  parseTask3Binding,
  requireTask3ExactKeys,
  requireTask3Object,
  Task3EvidenceError,
  task3Sha256,
} from "./task3-evidence-validation.mjs"
export {
  createTask3GateArtifact,
  parseTask3Receipt,
  REQUIRED_TASK3_GATES,
  TASK3_GATE_CONTRACTS,
  validateTask3Receipt,
} from "./task3-gate-contracts.mjs"
export { computeTask3SourceBinding } from "./task3-source-binding.mjs"

export async function writeFocusedReservationLifecycleReceipt(options) {
  requireTask3ExactKeys(options, ["attemptRoot", "cleanup", "observations", "repoRoot"])
  const repoRoot = options.repoRoot ?? process.cwd()
  const attemptRoot = await resolveTask3ActiveAttemptRoot(options.attemptRoot, repoRoot)
  const outputPath = path.join(attemptRoot, "focused-reservation-lifecycle.json")
  const passed =
    options.observations.length === 2 &&
    options.observations.every((entry) => entry.status === "passed") &&
    ["observer-and-barrier-closed", "fixture-graph-removed"].every((entry) =>
      options.cleanup.includes(entry),
    )
  await writeJsonMode600(
    outputPath,
    {
      cleanup: [...options.cleanup],
      command: "node --test tests/supabase-e2e/reservation-lifecycle.test.mjs",
      observations: options.observations.map((entry) => ({
        name: entry.name ?? "unnamed-observation",
        status: entry.status,
      })),
      recordType: "task-3-focused-receipt",
      schemaVersion: 1,
      source: await computeTask3SourceBinding(repoRoot),
      task: "task-3",
      verdict: passed ? "focused-pass" : "focused-fail",
    },
    { repoRoot },
  )
  return outputPath
}

export async function resolveTask3ActiveAttemptRoot(input, repoRoot) {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.includes("\0") ||
    input.includes("\\") ||
    input.split("/").includes("..")
  )
    throw new Task3EvidenceError(
      "Active attempt root must be explicitly supplied without traversal",
    )
  const remediation = path.join(
    repoRoot,
    ".omo/evidence/high-priority-missing-services/task-3/remediation",
  )
  const remediationReal = await realpath(remediation)
  if (remediationReal !== path.resolve(remediation))
    throw new Task3EvidenceError("Task 3 remediation ancestors must not contain symlinks")
  const resolved = path.resolve(repoRoot, input)
  const rootStats = await lstat(resolved)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
    throw new Task3EvidenceError("Active attempt root must be a real existing directory")
  const rootReal = await realpath(resolved)
  if (
    rootReal !== resolved ||
    path.dirname(rootReal) !== remediationReal ||
    !/^attempt-[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(path.basename(rootReal))
  )
    throw new Task3EvidenceError("Focused evidence must remain in one direct Task 3 attempt root")
  return rootReal
}

export async function resolveTask3AggregateEnvironment(options) {
  requireTask3ExactKeys(options, ["attemptRoot", "outputDir", "repoRoot"])
  const repoRoot = options.repoRoot ?? process.cwd()
  const attemptRoot = await resolveTask3ActiveAttemptRoot(options.attemptRoot, repoRoot)
  const attemptRelative = path.relative(repoRoot, attemptRoot).split(path.sep).join("/")
  const expectedOutputRelative = `${attemptRelative}/supabase-aggregate-outputs`
  if (options.attemptRoot !== attemptRelative || options.outputDir !== expectedOutputRelative) {
    throw new Task3EvidenceError(
      "Aggregate output must be the current attempt's confined output directory",
    )
  }
  const bindingPath = path.join(attemptRoot, "task-3-binding.json")
  const bindingStats = await lstat(bindingPath)
  if (bindingStats.isSymbolicLink() || !bindingStats.isFile())
    throw new Task3EvidenceError("Aggregate attempt binding must be a real file")
  let binding
  try {
    binding = parseTask3Binding(JSON.parse(await readFile(bindingPath, "utf8")))
  } catch (error) {
    if (error instanceof Task3EvidenceError) throw error
    throw new Task3EvidenceError("Aggregate attempt binding is malformed", { cause: error })
  }
  const currentSource = await computeTask3SourceBinding(repoRoot)
  if (
    binding.attemptId !== path.basename(attemptRoot) ||
    binding.head !== currentSource.head ||
    binding.sourceManifestSha256 !== currentSource.manifestSha256 ||
    binding.worktreeStatusSha256 !== currentSource.statusSha256
  )
    throw new Task3EvidenceError("Aggregate attempt binding does not match the current source")
  const outputDir = path.join(attemptRoot, "supabase-aggregate-outputs")
  try {
    const outputStats = await lstat(outputDir)
    if (outputStats.isSymbolicLink() || !outputStats.isDirectory())
      throw new Task3EvidenceError("Aggregate output must be a real directory")
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  return { attemptRoot, outputDir }
}
