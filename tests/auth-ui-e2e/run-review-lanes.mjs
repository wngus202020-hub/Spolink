#!/usr/bin/env node

import { constants } from "node:fs"
import { access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { namedSecurityTestFiles } from "./contracts.mjs"
import { runBuffered, sha256, writeJsonMode600 } from "./process.mjs"

const laneDefinitions = Object.freeze([
  {
    name: "plan-compliance",
    command: ["node", "tests/auth-ui-e2e/verify-plan-evidence.mjs", "compliance"],
  },
  {
    name: "static-quality",
    command: ["corepack", "pnpm", "typecheck"],
    next: ["corepack", "pnpm", "lint"],
  },
  {
    name: "security-contracts",
    command: ["node", "--test", ...namedSecurityTestFiles],
  },
  {
    name: "terminal-evidence",
    command: ["node", "tests/auth-ui-e2e/verify-plan-evidence.mjs", "manual-qa"],
    manualSummary: true,
  },
  {
    name: "source-fidelity",
    command: [
      "node",
      "tests/auth-ui-e2e/verify-source-fidelity.mjs",
      ".omo/evidence/baseline-supabase-auth-ui-session.json",
      ".omo/evidence/task-{1..8}-supabase-auth-ui-session-output.json",
    ],
  },
])

async function main() {
  const [planPath, outputPath, manualSummaryPath] = process.argv.slice(2)
  if (!planPath || !outputPath) {
    throw new Error(
      "usage: node tests/auth-ui-e2e/run-review-lanes.mjs <plan-path> <output-path> [manual-summary-path]",
    )
  }
  const lanes = []
  const summaryPath =
    manualSummaryPath ??
    process.env.SPOLINK_AUTH_MANUAL_QA_SUMMARY_PATH ??
    path.join(os.tmpdir(), "spolink-auth-manual-qa-summary.json")
  for (const definition of laneDefinitions) {
    lanes.push(await runLane(definition, { planPath, summaryPath }))
  }
  const verdict = lanes.every((lane) => lane.verdict === "APPROVE") ? "APPROVE" : "REJECT"
  await writeJsonMode600(outputPath, { lanes, verdict })
  if (verdict !== "APPROVE") process.exitCode = 1
}

async function runLane(definition, context) {
  const checks = []
  if (definition.name === "security-contracts") {
    const missing = await missingFiles(namedSecurityTestFiles)
    if (missing.length > 0) {
      checks.push({
        command: `missing security test files: ${missing.join(", ")}`,
        exitCode: 1,
        resultHash: sha256(JSON.stringify(missing)),
      })
      return { checks, name: definition.name, verdict: "REJECT" }
    }
  }
  const primary = buildPrimaryCommand(definition, context)
  checks.push(await runCheck(primary))
  if (definition.next) checks.push(await runCheck(definition.next))
  return {
    name: definition.name,
    checks,
    verdict: checks.every((check) => check.exitCode === 0) ? "APPROVE" : "REJECT",
  }
}

function buildPrimaryCommand(definition, context) {
  if (definition.name === "plan-compliance") return [...definition.command, context.planPath]
  if (definition.manualSummary) return [...definition.command, context.summaryPath]
  return definition.command
}

export async function missingFiles(files) {
  const missing = []
  for (const filePath of files) {
    try {
      await access(filePath, constants.R_OK)
    } catch (error) {
      if (error?.code === "ENOENT") {
        missing.push(filePath)
      } else {
        throw error
      }
    }
  }
  return missing
}

async function runCheck(command) {
  const [binary, ...args] = command
  const result = await runBuffered(binary, args, { timeoutMs: 900_000 })
  return {
    command: command.join(" "),
    exitCode: result.exitCode,
    resultHash: sha256(`${result.stdout}${result.stderr}`),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
