#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  assertRedactedMobileAuthReceipt,
  computeMobileAuthSourceHash,
  createMobileAuthRunId,
  resolveMobileAuthReceiptPath,
  sourceInventoryBaselinePath,
} from "./mobile-auth-signup-cleanup-race-contract.mjs"
import { buildChildEnv, runBuffered, sha256, writeJsonMode600 } from "./process.mjs"
import { safeRunnerFailure } from "./runner-failure.mjs"

export const aggregateApiPrerequisites = Object.freeze([
  "corepack pnpm test:api owns a guarded local Supabase and Next API lifecycle.",
])

export const focusedLifecycleContractTests = Object.freeze([
  "tests/auth-ui-e2e/lifecycle-failures.test.mjs",
  "tests/auth-ui-e2e/harness.test.mjs",
  "tests/auth-ui-e2e/auth-forms-contract.test.mjs",
  "tests/auth-ui-e2e/runner-redaction.test.mjs",
])

export const injectedFailureMatrix = Object.freeze([
  {
    env: { SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-config" },
    name: "injected-failure-after-config",
    expectedExit: "nonzero",
    expectedReceiptVerdict: "REJECT",
  },
  {
    env: { SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-next-ready" },
    name: "injected-failure-after-next-ready",
    expectedExit: "nonzero",
    expectedReceiptVerdict: "REJECT",
  },
  {
    env: { SPOLINK_AUTH_E2E_INJECT_FAILURE: "after-mailpit-link" },
    name: "injected-failure-after-mailpit-link",
    expectedExit: "nonzero",
    expectedReceiptVerdict: "REJECT",
  },
  {
    env: {
      SPOLINK_AUTH_E2E_INJECT_NAV_ABORT: "1",
      SPOLINK_AUTH_E2E_PROFILE_DELAY_MS: "2500",
    },
    name: "expected-nav-abort",
    expectedExit: "zero",
    expectedReceiptVerdict: "APPROVE",
  },
])

async function main() {
  const finalSummaryPath = await resolveMobileAuthReceiptPath(process.argv[2])
  const outputDir = path.dirname(finalSummaryPath)
  const runId = createMobileAuthRunId()
  const sourceHash = await computeMobileAuthSourceHash()
  const commands = await buildAggregateCommands({ outputDir, runId })
  const results = []
  for (const command of commands) {
    results.push(await runCommand(command))
  }
  const commandsWithReceipts = await attachCommandReceipts(results, commands)
  const canonicalCommand = commands.find((command) => command.name === "canonical-auth-ui-runner")
  const sourceInventoryCommand = commands.find((command) => command.name === "source-inventory")
  const canonicalReceipt = canonicalCommand?.receiptPath
    ? await readOptionalReceipt(canonicalCommand.receiptPath)
    : null
  const receipt = {
    schemaVersion: 1,
    artifacts: {
      canonicalReceiptPath: canonicalCommand?.receiptPath ?? null,
      sourceInventoryPath: sourceInventoryCommand?.receiptPath ?? null,
    },
    apiPrerequisites: aggregateApiPrerequisites,
    cleanupReceipt: canonicalReceipt
      ? {
          modeResults: canonicalReceipt.modeResults?.map((result) => ({
            cleanup: result.cleanup,
            enableConfirmations: result.enableConfirmations,
            outcome: result.outcome,
          })),
          verdict: canonicalReceipt.verdict,
        }
      : null,
    commands: commandsWithReceipts,
    failureMatrix: commandsWithReceipts.filter((result) => result.category === "failure-matrix"),
    runId,
    sourceHash,
    verdict: aggregateResultsApproved(commandsWithReceipts) ? "APPROVE" : "REJECT",
  }
  assertRedactedMobileAuthReceipt(receipt)
  await writeJsonMode600(finalSummaryPath, receipt)
  console.log(JSON.stringify({ runId, summaryPath: finalSummaryPath, verdict: receipt.verdict }))
  if (receipt.verdict !== "APPROVE") process.exitCode = 1
}

export async function buildAggregateCommands({ outputDir, runId }) {
  const canonicalReceiptPath = path.join(outputDir, `${runId}-canonical-runner.json`)
  const sourceInventoryPath = path.join(outputDir, `${runId}-source-inventory.json`)
  const commands = [
    gateCommand("typecheck", ["pnpm", "typecheck"], 300_000),
    gateCommand("lint", ["pnpm", "lint"], 300_000),
    gateCommand("build", ["pnpm", "build"], 900_000),
    {
      name: "canonical-auth-ui-runner",
      category: "required-gate",
      command: "corepack",
      args: ["pnpm", "exec", "node", "tests/auth-ui-e2e/run.mjs", canonicalReceiptPath],
      expectedExit: "zero",
      forwardControlEnv: true,
      receiptPath: canonicalReceiptPath,
      timeoutMs: 1_500_000,
    },
    ...injectedFailureMatrix.map((scenario) => ({
      name: scenario.name,
      category: "failure-matrix",
      command: "corepack",
      args: [
        "pnpm",
        "exec",
        "node",
        "tests/auth-ui-e2e/run.mjs",
        path.join(outputDir, `${runId}-${scenario.name}.json`),
      ],
      env: scenario.env,
      expectedExit: scenario.expectedExit,
      expectedReceiptVerdict: scenario.expectedReceiptVerdict,
      receiptPath: path.join(outputDir, `${runId}-${scenario.name}.json`),
      requireCleanupReceipt: true,
      timeoutMs: 1_500_000,
    })),
    {
      name: "focused-lifecycle-contracts",
      category: "required-gate",
      command: "corepack",
      args: ["pnpm", "exec", "node", "--test", ...focusedLifecycleContractTests],
      expectedExit: "zero",
      timeoutMs: 300_000,
    },
    await buildNodeContractCommand(),
    gateCommand("test-api", ["pnpm", "test:api"], 300_000, {
      prerequisites: aggregateApiPrerequisites,
    }),
    gateCommand("test-e2e-auth", ["pnpm", "test:e2e:auth"], 1_500_000),
    {
      name: "source-inventory",
      category: "required-gate",
      command: "corepack",
      args: [
        "pnpm",
        "exec",
        "node",
        "tests/auth-ui-e2e/verify-source-inventory.mjs",
        sourceInventoryPath,
        sourceInventoryBaselinePath,
      ],
      expectedExit: "zero",
      receiptPath: sourceInventoryPath,
      timeoutMs: 120_000,
    },
    {
      name: "supabase-assert-stopped",
      category: "cleanup-gate",
      command: "corepack",
      args: ["pnpm", "supabase:assert-stopped"],
      expectedExit: "zero",
      timeoutMs: 120_000,
    },
  ]
  return commands
}

function gateCommand(name, args, timeoutMs, extras = {}) {
  return {
    name,
    category: "required-gate",
    command: "corepack",
    args,
    expectedExit: "zero",
    timeoutMs,
    ...extras,
  }
}

async function buildNodeContractCommand() {
  const entries = await readdir("tests/auth-ui-e2e")
  const testFiles = entries
    .filter((entry) => entry.endsWith(".test.mjs"))
    .map((entry) => `tests/auth-ui-e2e/${entry}`)
    .sort()
  return {
    name: "auth-ui-node-contracts",
    category: "required-gate",
    command: "corepack",
    args: ["pnpm", "exec", "node", "--test", ...testFiles],
    expectedExit: "zero",
    timeoutMs: 180_000,
  }
}

async function runCommand({
  args,
  category,
  command,
  env = {},
  expectedExit,
  expectedReceiptVerdict,
  forwardControlEnv = false,
  name,
  prerequisites = [],
  receiptPath = null,
  requireCleanupReceipt = false,
  timeoutMs,
}) {
  const result = await runBuffered(command, args, {
    env: buildChildEnv(process.env, {
      ...(forwardControlEnv ? Object.fromEntries(readForwardedControlEnv()) : {}),
      ...env,
    }),
    timeoutMs,
  })
  return {
    approved: commandResultApproved({
      exitCode: result.exitCode,
      expectedExit,
      expectedReceiptVerdict,
      receipt: null,
      requireCleanupReceipt,
      signal: result.signal,
    }),
    category,
    expectedExit,
    expectedReceiptVerdict: expectedReceiptVerdict ?? null,
    name,
    exitCode: result.exitCode,
    invocation: `${command} ${args.join(" ")}`,
    outputSha256: sha256(`${result.stdout}${result.stderr}`),
    prerequisites,
    receiptPath,
    requireCleanupReceipt,
    signal: result.signal,
  }
}

export async function attachCommandReceipts(results, commands) {
  return Promise.all(
    results.map(async (result, index) => {
      const command = commands[index]
      const receipt = command?.receiptPath ? await readOptionalReceipt(command.receiptPath) : null
      const receiptSummary = summarizeReceipt(receipt)
      return {
        ...result,
        approved: commandResultApproved({
          exitCode: result.exitCode,
          expectedExit: command?.expectedExit,
          expectedReceiptVerdict: command?.expectedReceiptVerdict,
          receipt,
          requireCleanupReceipt: command?.requireCleanupReceipt === true,
          signal: result.signal,
        }),
        receipt: receiptSummary,
      }
    }),
  )
}

export function aggregateResultsApproved(results) {
  return results.every((result) => result.approved === true)
}

export function commandResultApproved({
  exitCode,
  expectedExit = "zero",
  expectedReceiptVerdict,
  receipt,
  requireCleanupReceipt = false,
  signal = null,
}) {
  if (signal !== null) return false
  const exitMatches =
    expectedExit === "nonzero" ? typeof exitCode === "number" && exitCode !== 0 : exitCode === 0
  if (!exitMatches) return false
  if (expectedReceiptVerdict && receipt?.verdict !== expectedReceiptVerdict) return false
  if (requireCleanupReceipt && !cleanupReceiptPresent(receipt)) return false
  return true
}

function summarizeReceipt(receipt) {
  if (!receipt) return null
  return {
    cleanupReceiptPresent: cleanupReceiptPresent(receipt),
    modeCount: Array.isArray(receipt.modeResults) ? receipt.modeResults.length : 0,
    runIdPresent: typeof receipt.runId === "string" && receipt.runId.length > 0,
    verdict: receipt.verdict ?? null,
  }
}

function cleanupReceiptPresent(receipt) {
  return (
    receipt?.cleanup?.settled === true ||
    (Array.isArray(receipt?.modeResults) &&
      receipt.modeResults.some(
        (result) =>
          result?.cleanup?.completed === true ||
          typeof result?.cleanup?.receiptPath === "string" ||
          result?.cleanup?.stoppedAsserted === true,
      ))
  )
}

function readForwardedControlEnv() {
  return [
    "SPOLINK_AUTH_E2E_INJECT_FAILURE",
    "SPOLINK_AUTH_E2E_INJECT_NAV_ABORT",
    "SPOLINK_AUTH_E2E_PROFILE_DELAY_MS",
  ]
    .map((key) => [key, process.env[key]])
    .filter((entry) => typeof entry[1] === "string" && entry[1].length > 0)
}

async function readOptionalReceipt(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.env.NODE_TEST_CONTEXT !== "child-v8"
) {
  try {
    await main()
  } catch (error) {
    console.error(JSON.stringify(safeRunnerFailure(error)))
    process.exitCode = 1
  }
}
