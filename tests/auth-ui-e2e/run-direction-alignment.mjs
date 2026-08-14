#!/usr/bin/env node
import { lstat, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import {
  buildMatrix,
  collectArtifacts,
  collectObservations,
  collectTests,
  collectTestsSafely,
  emptyMatrix,
  observationApproved,
  projects,
  sum,
} from "./direction-alignment-matrix.mjs"
import {
  capturePort3000,
  DirectionAlignmentLifecycle,
} from "./direction-alignment-runner-lifecycle.mjs"
import { buildChildEnv, runBuffered, sha256 } from "./process.mjs"

const specPattern = /^direction-alignment-[a-z0-9-]+\.spec\.ts$/
const repoRoot = process.cwd()
const sourceFiles = [
  "package.json",
  "playwright.auth.config.ts",
  "tests/auth-ui-e2e/direction-alignment-smoke.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-media.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-search.spec.ts",
  "tests/auth-ui-e2e/direction-alignment-home.spec.ts",
  "tests/auth-ui-e2e/run-direction-alignment.mjs",
  "tests/auth-ui-e2e/run-direction-regressions.mjs",
]
process.umask(0o077)

const lifecycle = new DirectionAlignmentLifecycle(repoRoot)
let shuttingDown = false

async function main() {
  const [outputPath, ...requestedSpecs] = process.argv.slice(2)
  if (!outputPath || process.argv.slice(2).length !== requestedSpecs.length + 1) {
    throw new Error(
      "usage: node tests/auth-ui-e2e/run-direction-alignment.mjs <output-summary-path> [direction-alignment-*.spec.ts...]",
    )
  }
  const absoluteOutputPath = path.resolve(repoRoot, outputPath)
  const sourceHashesBefore = await captureSourceHashes()
  const port3000Before = await capturePort3000()
  let result = null
  let observations = []
  let artifacts = []
  let matrix = emptyMatrix()
  let error = null

  try {
    const specs = await resolveSpecs(requestedSpecs)
    const rawOutputDir = await lifecycle.prepareRawOutput()
    const baseUrl = await lifecycle.buildAndStart()
    result = await runBuffered(
      "corepack",
      [
        "pnpm",
        "exec",
        "playwright",
        "test",
        "--config=playwright.auth.config.ts",
        ...specs,
        ...projects.map((project) => `--project=${project}`),
        "--reporter=json",
      ],
      {
        env: buildChildEnv(process.env, {
          NODE_ENV: "test",
          SPOLINK_AUTH_E2E_BASE_URL: baseUrl,
          SPOLINK_AUTH_E2E_PLAYWRIGHT_OUTPUT_DIR: rawOutputDir,
          SPOLINK_DIRECTION_INJECT_OVERFLOW: process.env["SPOLINK_DIRECTION_INJECT_OVERFLOW"] ?? "",
          SPOLINK_DIRECTION_INJECT_ROUTE_ABORT:
            process.env["SPOLINK_DIRECTION_INJECT_ROUTE_ABORT"] ?? "",
        }),
      },
    )
    await lifecycle.chmodRawRoot()
    observations = await collectObservations(rawOutputDir)
    artifacts = await collectArtifacts(rawOutputDir)
    matrix = await buildMatrix(repoRoot, observations, artifacts)
    const scenarios = collectTests(JSON.parse(result.stdout))
    const approved =
      result.exitCode === 0 &&
      scenarios.length > 0 &&
      scenarios.every((scenario) => scenario.status === "passed") &&
      observations.every(observationApproved) &&
      matrix.approved
    if (!approved) error = new Error("Playwright direction-alignment assertions rejected")
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught))
  }

  const cleanup = await lifecycle.cleanupOwned()
  const sourceHashes = await captureSourceHashes()
  const sourceStable = JSON.stringify(sourceHashes) === JSON.stringify(sourceHashesBefore)
  const port3000After = await capturePort3000()
  const port3000Preserved = port3000After === port3000Before
  const verdict =
    !error && cleanup.exitCode === 0 && port3000Preserved && sourceStable ? "APPROVE" : "REJECT"
  const summary = {
    schemaVersion: 2,
    verdict,
    source: { files: sourceHashes, stableDuringRun: sourceStable },
    projects,
    specs: await safeSpecs(requestedSpecs),
    scenarios: result ? collectTestsSafely(result.stdout) : [],
    observations,
    matrix,
    totals: {
      consoleErrorCount: sum(observations, "consoleErrorCount"),
      failedAppRequestCount: sum(observations, "failedAppRequestCount"),
      focusEscapeCount: sum(observations, "focusEscapeCount"),
      horizontalOverflowPixels: sum(observations, "horizontalOverflow"),
      pageErrorCount: sum(observations, "pageErrorCount"),
    },
    artifacts,
    outputSha256: result ? sha256(`${result.stdout}${result.stderr}`) : null,
    cleanup: {
      ...cleanup,
      port3000AfterSha256: sha256(port3000After),
      port3000BeforeSha256: sha256(port3000Before),
      port3000Preserved,
    },
    error: error ? redact(error.message) : null,
  }
  await mkdir(path.dirname(absoluteOutputPath), { mode: 0o700, recursive: true })
  await writeRedactedJson(absoluteOutputPath, summary, [])
  if (verdict !== "APPROVE") process.exitCode = 1
  console.log(JSON.stringify({ summaryPath: outputPath, verdict }))
}

async function captureSourceHashes() {
  const rows = []
  for (const file of sourceFiles) {
    rows.push({ path: file, sha256: sha256(await readFile(path.join(repoRoot, file))) })
  }
  return rows
}

async function resolveSpecs(requestedSpecs) {
  const names = requestedSpecs.length
    ? requestedSpecs
    : (await readdir(path.join(repoRoot, "tests/auth-ui-e2e")))
        .filter((name) => specPattern.test(name))
        .sort()
        .map((name) => `tests/auth-ui-e2e/${name}`)
  if (names.length === 0) throw new Error("No direction-alignment specs found")
  for (const spec of names) {
    const expected = `tests/auth-ui-e2e/${path.basename(spec)}`
    if (spec !== expected || !specPattern.test(path.basename(spec))) {
      throw new Error(`Invalid exact direction-alignment spec path: ${spec}`)
    }
    const stats = await lstat(path.join(repoRoot, spec))
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Spec must be a real file: ${spec}`)
    }
  }
  return names
}

async function safeSpecs(requestedSpecs) {
  try {
    return await resolveSpecs(requestedSpecs)
  } catch {
    return requestedSpecs.map((spec) => path.basename(spec))
  }
}

function redact(value) {
  return value
    .replaceAll(repoRoot, "<repo>")
    .replace(/\b[A-Za-z0-9._%+-]+@spolink\.test\b/giu, "<redacted-email>")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "<redacted-postgres-url>")
}

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  await lifecycle.cleanupOwned()
  process.exit(signal === "SIGINT" ? 130 : 143)
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void shutdown(signal))

try {
  await main()
} catch (error) {
  console.error(
    error instanceof Error ? redact(error.message) : "direction-alignment runner failed",
  )
  process.exitCode = 1
}
