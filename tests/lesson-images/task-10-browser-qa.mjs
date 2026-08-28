import { mkdir } from "node:fs/promises"

import { readEvidenceConfiguration } from "./task10-browser/evidence-provenance.mjs"
import { runTask10BrowserQa } from "./task10-browser/orchestrator.mjs"
import { createPrivateJsonWriter } from "./task10-browser/private-json.mjs"
import { createProcessRunner } from "./task10-browser/process-runner.mjs"

const runnerStartedAt = new Date()
const { evidenceDir, provenance: directoryProvenance } = readEvidenceConfiguration(
  process.argv[2],
  runnerStartedAt,
)
await mkdir(evidenceDir, { mode: 0o700, recursive: true })
const writePrivateJson = createPrivateJsonWriter(evidenceDir)
const processRunner = createProcessRunner({ repoRoot: process.cwd(), writePrivateJson })
const context = {
  directoryProvenance,
  evidenceDir,
  processRunner,
  repoRoot: process.cwd(),
  runnerStartedAt,
  sourceBinding: null,
  writePrivateJson,
}

processRunner.installSignals()
try {
  await runTask10BrowserQa(context)
} finally {
  processRunner.disposeSignals()
}
