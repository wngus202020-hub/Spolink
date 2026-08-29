#!/usr/bin/env node
import { writeCoachDashboardEvidence } from "./coach-dashboard-evidence.mjs"
import { resolveCoachDashboardRunTarget } from "./coach-dashboard-run-target.mjs"
import {
  defaultCoachDashboardEpoch,
  executeCoachDashboardRun,
} from "./coach-dashboard-runner-core.mjs"
import { updateCoachDashboardTask7Manifest } from "./coach-dashboard-task7-manifest.mjs"
import { writeCoachDashboardTask8Reports } from "./coach-dashboard-task8-reports.mjs"
import { resolveEvidenceChildPath } from "./evidence-paths.mjs"

async function main() {
  const cli = readCli(process.argv.slice(2))
  const target = resolveCoachDashboardRunTarget(cli.grep)
  const outputPath = await resolveEvidenceChildPath(cli.outputPath ?? target.outputPath, {
    kind: "file",
    suffix: ".json",
  })
  const visualDir = await resolveEvidenceChildPath(
    process.env["SPOLINK_COACH_DASHBOARD_VISUAL_DIR"] ?? target.visualDir,
    { kind: "directory" },
  )
  const failurePoint = process.env["SPOLINK_COACH_DASHBOARD_INJECT_FAILURE"] ?? null
  const allowInjectedFailure = process.env["SPOLINK_COACH_DASHBOARD_RUNNER_CONTRACT"] === "1"
  const summary = await executeCoachDashboardRun({
    allowInjectedFailure,
    epoch: process.env["SPOLINK_COACH_DASHBOARD_EPOCH"] ?? defaultCoachDashboardEpoch(new Date()),
    failurePoint,
    grep: cli.grep,
    outputPath,
    visualDir,
  })
  await writeCoachDashboardEvidence(outputPath, summary)
  if (
    cli.outputPath === null &&
    target.variant === "visual-responsive" &&
    summary.verdict === "APPROVE"
  ) {
    await writeCoachDashboardTask8Reports({ root: target.root, summary })
  }
  if (cli.outputPath === null && target.root.endsWith("/task-7") && target.variant !== "full") {
    await updateCoachDashboardTask7Manifest({ root: target.root })
  }
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
