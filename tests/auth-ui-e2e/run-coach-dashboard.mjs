#!/usr/bin/env node
import { writeCoachDashboardEvidence } from "./coach-dashboard-evidence.mjs"
import { executeCoachDashboardRun } from "./coach-dashboard-runner-core.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"

const defaultOutput = ".omo/evidence/coach-dashboard-screen/task-6/managed-run.json"
const defaultVisualDir = ".omo/evidence/coach-dashboard-screen/task-6/managed-visual"
const defaultEpoch = "2026-08-29T03:00:00.000Z"

async function main() {
  const cli = readCli(process.argv.slice(2))
  const outputPath = await resolveEvidenceChildPath(cli.outputPath ?? defaultOutput, {
    kind: "file",
    suffix: ".json",
  })
  const visualDir = await resolveEvidenceChildPath(
    process.env["SPOLINK_COACH_DASHBOARD_VISUAL_DIR"] ?? defaultVisualDir,
    { kind: "directory" },
  )
  const failurePoint = process.env["SPOLINK_COACH_DASHBOARD_INJECT_FAILURE"] ?? null
  const allowInjectedFailure = process.env["SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT"] === "1"
  const summary = await executeCoachDashboardRun({
    allowInjectedFailure,
    epoch: process.env["SPOLINK_COACH_DASHBOARD_EPOCH"] ?? defaultEpoch,
    failurePoint,
    grep: cli.grep,
    outputPath,
    visualDir,
  })
  await writeCoachDashboardEvidence(outputPath, summary)
  if (summary.verdict !== "APPROVE") process.exitCode = 1
}

function readCli(args) {
  let outputPath = null
  let grep = null
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === "--grep") {
      grep = args[index + 1] ?? null
      index += 1
    } else if (value?.startsWith("--grep=")) {
      grep = value.slice("--grep=".length)
    } else if (value !== "--") {
      if (outputPath !== null)
        throw new Error(`Unsupported coach dashboard runner argument: ${value}`)
      outputPath = value ?? null
    }
  }
  return { grep, outputPath }
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
