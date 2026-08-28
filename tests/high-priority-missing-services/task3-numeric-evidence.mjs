#!/usr/bin/env node
import { chmod, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"

import { runBuffered, writeJsonMode600 } from "../auth-ui-e2e/process.mjs"
import { requireTask3ExactKeys, Task3EvidenceError } from "./task3-evidence.mjs"

const focusedCommand = Object.freeze([
  "corepack",
  "pnpm",
  "exec",
  "node",
  "--test",
  "tests/high-priority-missing-services/task3-evidence.test.mjs",
  "tests/high-priority-missing-services/task3-directory-publisher.test.mjs",
  "tests/high-priority-missing-services/task3-source-binding.test.mjs",
])
const focusedContractTotal = 21
const pureLocLimit = 250
const splitFiles = Object.freeze({
  environment: "tests/high-priority-missing-services/task3-evidence-environment-tests.mjs",
  finalizer: "tests/high-priority-missing-services/finalize-task3.mjs",
  root: "tests/high-priority-missing-services/task3-evidence.test.mjs",
})
const pureLocCommand = "awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(#|\\/\\/)/' <file> | wc -l"

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli()

export function materializeTask3FocusedContract(tapOutput) {
  if (typeof tapOutput !== "string") throw new Task3EvidenceError("Focused TAP output must be text")
  const summary = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [
      name,
      parseTapCount(tapOutput, name),
    ]),
  )
  if (
    summary.fail !== 0 ||
    summary.cancelled !== 0 ||
    summary.skipped !== 0 ||
    summary.todo !== 0 ||
    summary.pass !== summary.tests
  ) {
    throw new Task3EvidenceError(
      "Focused TAP contains failed, skipped, cancelled, or incomplete tests",
    )
  }
  if (summary.tests !== focusedContractTotal) {
    throw new Task3EvidenceError("Focused TAP total does not match current contract")
  }
  return {
    failedCount: summary.fail,
    passedCount: summary.pass,
    skippedCount: summary.skipped,
    suiteCount: summary.tests,
  }
}

export async function materializeTask3SplitInclusion(repoRoot = process.cwd()) {
  const loc = {}
  for (const [name, relativePath] of Object.entries(splitFiles)) {
    const count = await countPureLoc(path.join(repoRoot, relativePath))
    if (count > pureLocLimit)
      throw new Task3EvidenceError(`${relativePath} exceeds ${pureLocLimit} pure LOC`)
    loc[name] = count
  }
  return {
    command: pureLocCommand,
    limit: pureLocLimit,
    loc,
    recordType: "task-7-current-split-inclusion",
    schemaVersion: 2,
    verdict: "passed",
  }
}

export async function validateTask3SplitInclusion(value, repoRoot = process.cwd()) {
  requireTask3ExactKeys(value, [
    "command",
    "limit",
    "loc",
    "recordType",
    "schemaVersion",
    "verdict",
  ])
  const current = await materializeTask3SplitInclusion(repoRoot)
  if (!isDeepStrictEqual(value, current)) {
    throw new Task3EvidenceError("Split inclusion numeric evidence does not match current source")
  }
  return current
}

async function runCli() {
  try {
    const outputPath = parseArgs(process.argv.slice(2))
    await mkdir(path.dirname(outputPath), { mode: 0o700, recursive: true })
    await chmod(path.dirname(outputPath), 0o700)
    const result = await runBuffered(focusedCommand[0], focusedCommand.slice(1))
    if (result.exitCode !== 0) throw new Task3EvidenceError("Focused contract command failed")
    const focused = materializeTask3FocusedContract(`${result.stdout}\n${result.stderr}`)
    const splitInclusion = await materializeTask3SplitInclusion()
    await writeJsonMode600(
      outputPath,
      {
        focused,
        focusedCommand: focusedCommand.join(" "),
        recordType: "task-3-numeric-evidence-remediation",
        schemaVersion: 1,
        splitInclusion,
        verdict: "passed",
      },
      { repoRoot: process.cwd() },
    )
    process.stdout.write(
      `${JSON.stringify({ focused, loc: splitInclusion.loc, verdict: "passed" })}\n`,
    )
  } catch (error) {
    process.stderr.write(
      `Task 3 numeric evidence rejected: ${error instanceof Error ? error.message : "unknown error"}\n`,
    )
    process.exitCode = 1
  }
}

function parseArgs(values) {
  if (values.length !== 2 || values[0] !== "--output" || !values[1]) {
    throw new Task3EvidenceError("Usage: task3-numeric-evidence.mjs --output <private-json-path>")
  }
  return path.resolve(values[1])
}

function parseTapCount(output, name) {
  const matches = [...output.matchAll(new RegExp(`^ℹ ${name} ([0-9]+)\\r?$`, "gmu"))]
  if (matches.length !== 1 || matches[0]?.[1] === undefined) {
    throw new Task3EvidenceError(`Focused TAP must contain one ${name} summary`)
  }
  return Number(matches[0][1])
}

async function countPureLoc(filePath) {
  const body = await readFile(filePath, "utf8")
  return body.split("\n").filter((line) => {
    const trimmed = line.trimStart()
    return trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("//")
  }).length
}
