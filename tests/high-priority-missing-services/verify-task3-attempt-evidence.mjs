#!/usr/bin/env node
import { chmod, lstat, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { verifyTask3AttemptSeal } from "./task3-attempt-seal.mjs"
import { verifyTask3BaselinePackage } from "./task3-baseline-package.mjs"
import {
  isTask3SafeRelativePath,
  resolveTask3ActiveAttemptRoot,
  Task3EvidenceError,
} from "./task3-evidence.mjs"
import { inspectTask3Attempt, task3TerminalOutputPolicy } from "./task3-evidence-scanner.mjs"

const manifestName = "task-7-current-attempt-index.json"
const resultName = "task-7-evidence-hygiene.json"
const generatedNames = new Set([
  manifestName,
  resultName,
  "artifacts/evidence-scan.json",
  "receipts/evidence-scan.json",
])
const sha256Pattern = /^[a-f0-9]{64}$/u

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli()

export async function buildTask3AttemptManifest(input, repoRoot = process.cwd()) {
  const attemptRoot = await resolveTask3ActiveAttemptRoot(input, repoRoot)
  const { files } = await inspectTask3Attempt(attemptRoot)
  return {
    algorithm: "sha256",
    attemptId: path.basename(attemptRoot),
    recordType: "task-3-attempt-evidence-index",
    references: files.map(({ relative, sha256 }) => ({ path: relative, sha256 })),
    schemaVersion: 2,
    terminalOutputPolicy: task3TerminalOutputPolicy,
  }
}

export async function verifyTask3AttemptEvidence(options, repoRoot = process.cwd(), hooks = {}) {
  const attemptRoot = await resolveTask3ActiveAttemptRoot(options.attemptRoot, repoRoot)
  const manifest = options.manifest
  validateManifest(manifest, path.basename(attemptRoot))
  const { files, terminalOutputs } = await inspectTask3Attempt(attemptRoot, hooks)
  const expected = manifest.references
  if (
    files.length !== expected.length ||
    files.some((file, index) => file.relative !== expected[index].path)
  ) {
    throw new Task3EvidenceError("Attempt evidence file set does not match its manifest")
  }
  for (let index = 0; index < files.length; index += 1) {
    if (files[index].sha256 !== expected[index].sha256) {
      throw new Task3EvidenceError(`Attempt evidence hash drift: ${files[index].relative}`)
    }
  }
  return {
    checks: [
      "private-modes",
      "safe-nodes",
      "json-parse",
      "contained-references",
      "hashes",
      "secret-pii",
      "sorted-manifest",
      "terminal-output-policy",
    ],
    fileCount: files.length,
    missingReferences: 0,
    parseErrors: 0,
    secretFindings: 0,
    terminalOutputCount: terminalOutputs.length,
    terminalOutputs,
    unsafeNodes: 0,
  }
}

function validateManifest(value, attemptId) {
  if (
    (value?.schemaVersion !== 1 && value?.schemaVersion !== 2) ||
    value.recordType !== "task-3-attempt-evidence-index" ||
    value.algorithm !== "sha256" ||
    value.attemptId !== attemptId ||
    !Array.isArray(value.references)
  ) {
    throw new Task3EvidenceError("Attempt evidence manifest schema is invalid")
  }
  if (
    value.schemaVersion === 2 &&
    !isDeepStrictEqual(value.terminalOutputPolicy, task3TerminalOutputPolicy)
  ) {
    throw new Task3EvidenceError("Attempt evidence terminal output policy is invalid")
  }
  const paths = value.references.map((entry) => entry?.path)
  if (paths.some((entry) => !isTask3SafeRelativePath(entry) || generatedNames.has(entry))) {
    throw new Task3EvidenceError("Attempt evidence manifest contains an unsafe path")
  }
  if (paths.some((entry, index) => index > 0 && paths[index - 1].localeCompare(entry) >= 0)) {
    throw new Task3EvidenceError("Attempt evidence manifest references must be uniquely sorted")
  }
  if (value.references.some((entry) => !sha256Pattern.test(entry.sha256))) {
    throw new Task3EvidenceError("Attempt evidence manifest hash is invalid")
  }
}

async function runCli() {
  try {
    const attemptRoot = parseArgs(process.argv.slice(2))
    const resolved = await resolveTask3ActiveAttemptRoot(attemptRoot, process.cwd())
    await verifyTask3BaselinePackage(resolved)
    const manifestPath = path.join(resolved, manifestName)
    const resultPath = path.join(resolved, resultName)
    const generatedState = await readGeneratedState(manifestPath, resultPath)
    if (generatedState === "absent") {
      const manifest = await buildTask3AttemptManifest(resolved)
      await writePrivate(manifestPath, manifest)
      const result = await verifyTask3AttemptEvidence({ attemptRoot: resolved, manifest })
      await writePrivate(resultPath, {
        ...result,
        command: `corepack pnpm exec node tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs --attempt ${path.relative(process.cwd(), resolved)}`,
        producer: "tests/high-priority-missing-services/verify-task3-attempt-evidence.mjs",
        recordType: "task-3-attempt-evidence-scan",
        schemaVersion: 1,
        verdict: "passed",
      })
      process.stdout.write(
        `${JSON.stringify({ fileCount: result.fileCount, sealed: true, verdict: "passed" })}\n`,
      )
      return
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
    const result = await verifyTask3AttemptEvidence({ attemptRoot: resolved, manifest })
    const seal = await verifyTask3AttemptSeal(resolved)
    const summary = {
      fileCount: result.fileCount,
      receiptCount: seal.receiptCount,
      sealed: true,
      terminalOutputs: result.terminalOutputs,
      verdict: "passed",
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`)
  } catch (error) {
    process.stderr.write(
      `Task 3 attempt evidence rejected: ${error instanceof Error ? error.message : "unknown error"}\n`,
    )
    process.exitCode = 1
  }
}

async function readGeneratedState(manifestPath, resultPath) {
  const states = await Promise.all(
    [manifestPath, resultPath].map(async (filePath) => {
      try {
        const fileStat = await lstat(filePath)
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
          throw new Task3EvidenceError("Evidence seal generated files must be regular files")
        }
        return "present"
      } catch (error) {
        if (error?.code === "ENOENT") return "absent"
        throw error
      }
    }),
  )
  if (states[0] !== states[1]) throw new Task3EvidenceError("Evidence seal is incomplete")
  return states[0]
}

function parseArgs(values) {
  if (values.length !== 2 || values[0] !== "--attempt" || !values[1])
    throw new Task3EvidenceError(
      "Usage: verify-task3-attempt-evidence.mjs --attempt <active-attempt-dir>",
    )
  return values[1]
}

async function writePrivate(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}
