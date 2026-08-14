import { readFile } from "node:fs/promises"

import { buildGate0Checklist, validateGate0ResourceInput, writeSafeEvidence } from "./contract.mjs"

const output = readOption("--output")
const input = readOption("--input")
if (!output) {
  console.error("Missing required --output path")
  process.exitCode = 2
} else {
  try {
    const resourceState = input
      ? validateGate0ResourceInput(JSON.parse(await readFile(input, "utf8")))
      : {}
    const evidence = await writeSafeEvidence(output, buildGate0Checklist(resourceState))
    console.log(JSON.stringify(evidence))
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gate 0 checklist failed")
    process.exitCode = 1
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}
