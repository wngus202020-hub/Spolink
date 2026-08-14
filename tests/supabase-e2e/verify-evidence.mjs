#!/usr/bin/env node
import { spawn } from "node:child_process"

import { createVerifierContext } from "./verify-evidence/constants.mjs"
import { createF4FinalFromPreflight } from "./verify-evidence/f4-final.mjs"
import { readRemediationManifest } from "./verify-evidence/remediation.mjs"
import { verifyTargets } from "./verify-evidence/targets.mjs"

async function main() {
  const args = process.argv.slice(2)
  const context = createVerifierContext()
  if (args[0] === "create-f4-final") {
    console.log(JSON.stringify(await createF4FinalFromPreflight(context)))
    return
  }
  if (args[0] === "approve-task8") {
    throw new Error("approve-task8 is obsolete; verify task-8 requires latest attempt APPROVE")
  }
  if (args[0] === "finalize-task8-resume1") {
    throw new Error("finalize-task8-resume1 is closed; retained historical evidence is read-only")
  }
  const remediation = await readRemediationManifest(context)
  await verifyTargets(context, args, remediation)
  await runSecretScan(context)
  console.log(JSON.stringify({ evidenceVerification: "ok", targets: args }))
}

async function runSecretScan(context) {
  if (!context.runSecretScan) return
  const result = await spawnBuffered(process.execPath, [
    ".omo/scripts/task-7-full-evidence-secret-scan.mjs",
    "--root",
    context.evidenceRoot,
  ])
  if (result.exitCode !== 0) {
    throw new Error(`recursive evidence secret scan failed\n${result.stdout}${result.stderr}`)
  }
}

function spawnBuffered(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", reject)
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stderr, stdout }))
  })
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
