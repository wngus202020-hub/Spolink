import {
  isTask3IsoTimestamp,
  isTask3SafeAttemptId,
  isTask3SafeRelativePath,
  requireTask3ExactKeys,
  requireTask3Object,
  Task3EvidenceError,
  task3HeadPattern,
  task3Sha256Pattern,
} from "./task3-evidence-validation.mjs"

export const REQUIRED_TASK3_GATES = Object.freeze([
  "focused-contract",
  "focused-db",
  "real-http",
  "browser-desktop",
  "browser-mobile",
  "supabase-aggregate",
  "typecheck",
  "lint",
  "build",
  "evidence-scan",
  "stopped-cleanup",
])

const evidenceScanCommandPrefix =
  "corepack pnpm exec node tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs --attempt"
const remediationRelativeRoot = ".omo/evidence/high-priority-missing-services/task-3/remediation"

// biome-ignore format: dense immutable rows make the exact gate matrix auditable as one table.
export const TASK3_GATE_CONTRACTS = Object.freeze({
  "focused-contract": gateContract("tests/high-priority-missing-services/task3-evidence.test.mjs",
    "corepack pnpm exec node --test tests/high-priority-missing-services/task3-evidence.test.mjs tests/high-priority-missing-services/task3-directory-publisher.test.mjs tests/high-priority-missing-services/task3-source-binding.test.mjs", 21, 0,
    ["sentinel-preserved", "path-boundary", "semantic-artifacts", "attempt-evidence-boundary", "output-directory-anchor", "native-failure-cleanup"], { failedTests: 0 }),
  "focused-db": gateContract("tests/supabase-e2e/reservation-lifecycle.test.mjs",
    task3AggregateCommand, 2, 0,
    ["authorization-state-replay-effects", "competing-transition-races"], { failedObservations: 0 }),
  "real-http": gateContract("tests/supabase-e2e/reservation-lifecycle-api.test.mjs",
    task3AggregateCommand, 1, 0,
    ["authorization-matrix", "rejected-rollback", "replay-semantics"], { rollbackFailures: 0 }),
  "browser-desktop": gateContract("tests/auth-ui-e2e/run-learner-reservations.mjs",
    "corepack pnpm test:e2e:reservations", 1, 2,
    ["desktop-chromium", "owned-reservations-only", "foreign-detail-denied"],
    { expectedProjects: 2, passedProjects: 2, project: "desktop-chromium" }),
  "browser-mobile": gateContract("tests/auth-ui-e2e/run-learner-reservations.mjs",
    "corepack pnpm test:e2e:reservations", 1, 2,
    ["mobile-chromium", "owned-reservations-only", "foreign-detail-denied"],
    { expectedProjects: 2, passedProjects: 2, project: "mobile-chromium" }),
  "supabase-aggregate": gateContract("tests/supabase-e2e/run.mjs", task3AggregateCommand, 9, 0,
    ["db-tests", "configured-http", "lifecycle-races"], { failedSuites: 0 }),
  typecheck: gateContract("package.json#scripts.typecheck", "corepack pnpm typecheck", 1, 0,
    ["diagnostics-zero"], { diagnostics: 0 }),
  lint: gateContract("package.json#scripts.lint", "corepack pnpm lint", 1, 0,
    ["errors-zero"], { errors: 0, warnings: 0 }),
  build: gateContract("package.json#scripts.build", "corepack pnpm build", 1, 0,
    ["next-build-complete"], { exitCode: 0 }),
  "evidence-scan": gateContract("tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs",
    task3EvidenceScanCommand,
    1, 0, ["private-modes", "safe-nodes", "json-parse", "contained-references", "hashes", "secret-pii", "sorted-manifest"],
    { missingReferences: 0, parseErrors: 0, secretFindings: 0, unsafeNodes: 0 }),
  "stopped-cleanup": gateContract("scripts/supabase-local.mjs#assert-stopped",
    "corepack pnpm supabase:assert-stopped", 1, 0,
    ["ports-zero", "containers-zero", "volumes-zero", "networks-zero"],
    { containers: 0, networks: 0, ports: 0, residueCount: 0, stopped: true, volumes: 0 }),
})

export function createTask3GateArtifact(attemptId, gate, source) {
  const contract = TASK3_GATE_CONTRACTS[gate]
  if (!contract) throw new Task3EvidenceError(`Unknown Task 3 gate: ${gate}`)
  return {
    attemptId,
    command: task3GateCommand(attemptId, gate),
    gate,
    producer: contract.producer,
    recordType: "task-3-gate-result",
    result: contract.result,
    schemaVersion: 1,
    source,
    task: "task-3",
  }
}

export function parseTask3Receipt(value) {
  requireTask3Object(value, "receipt")
  requireTask3ExactKeys(value, [
    "artifact",
    "attemptId",
    "command",
    "exitCode",
    "gate",
    "observedAt",
    "producer",
    "recordType",
    "schemaVersion",
    "source",
    "task",
    "verdict",
  ])
  requireTask3Object(value.source, "receipt source")
  requireTask3ExactKeys(value.source, ["head", "manifestSha256", "statusSha256"])
  requireTask3Object(value.artifact, "receipt artifact")
  requireTask3ExactKeys(value.artifact, ["mediaType", "path", "sha256"])
  const contract = TASK3_GATE_CONTRACTS[value.gate]
  if (
    value.schemaVersion !== 1 ||
    value.recordType !== "task-3-gate-receipt" ||
    value.task !== "task-3" ||
    !REQUIRED_TASK3_GATES.includes(value.gate) ||
    !isTask3SafeAttemptId(value.attemptId) ||
    !contract ||
    value.command !== task3GateCommand(value.attemptId, value.gate) ||
    value.producer !== contract.producer ||
    value.exitCode !== 0 ||
    value.verdict !== "passed" ||
    !isTask3IsoTimestamp(value.observedAt) ||
    !task3HeadPattern.test(value.source.head) ||
    !task3Sha256Pattern.test(value.source.manifestSha256) ||
    !task3Sha256Pattern.test(value.source.statusSha256) ||
    !isTask3SafeRelativePath(value.artifact.path) ||
    !task3Sha256Pattern.test(value.artifact.sha256) ||
    value.artifact.mediaType !== "application/json" ||
    value.artifact.path !== `artifacts/${value.gate}.json`
  )
    throw new Task3EvidenceError("Receipt schema or verdict is invalid")
  return value
}

export function task3GateCommand(attemptId, gate) {
  const contract = TASK3_GATE_CONTRACTS[gate]
  if (!contract) throw new Task3EvidenceError(`Unknown Task 3 gate: ${gate}`)
  return typeof contract.command === "function" ? contract.command(attemptId) : contract.command
}

export function validateTask3Receipt(receipt, context) {
  if (context.receiptsByGate.has(receipt.gate))
    throw new Task3EvidenceError(`Duplicate receipt: ${receipt.gate}`)
  if (receipt.attemptId !== context.binding.attemptId)
    throw new Task3EvidenceError("Receipt belongs to a different attempt")
  if (
    receipt.source.head !== context.binding.head ||
    receipt.source.manifestSha256 !== context.binding.sourceManifestSha256 ||
    receipt.source.statusSha256 !== context.binding.worktreeStatusSha256
  )
    throw new Task3EvidenceError("Receipt source binding is stale")
  if (Date.parse(receipt.observedAt) < Date.parse(context.binding.capturedAt))
    throw new Task3EvidenceError("Receipt predates the current binding")
}

function gateContract(producer, command, suiteCount, projectCount, checks, facts) {
  return {
    command,
    producer,
    result: {
      checks,
      facts,
      failedCount: 0,
      passedCount: suiteCount,
      projectCount,
      skippedCount: 0,
      suiteCount,
    },
  }
}

function task3EvidenceScanCommand(attemptId) {
  if (!isTask3SafeAttemptId(attemptId))
    throw new Task3EvidenceError("Evidence scan attempt ID is invalid")
  return `${evidenceScanCommandPrefix} ${remediationRelativeRoot}/${attemptId}`
}

function task3AggregateCommand(attemptId) {
  if (!isTask3SafeAttemptId(attemptId))
    throw new Task3EvidenceError("Aggregate attempt ID is invalid")
  const attemptRoot = `${remediationRelativeRoot}/${attemptId}`
  return (
    "corepack pnpm exec node " +
    "tests/high-priority-missing-services/run-task3-supabase-receipt.mjs " +
    `--attempt ${attemptRoot}`
  )
}
