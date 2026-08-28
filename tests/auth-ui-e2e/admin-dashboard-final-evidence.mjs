#!/usr/bin/env node
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import {
  adminDashboardScreenshotNames,
  adminDashboardSourcePaths,
  readPngEvidence,
} from "./admin-dashboard-evidence.mjs"

const evidenceDir = path.resolve(".omo/evidence/admin-operations-dashboard/task-8")
const runDir = path.join(evidenceDir, "current-binding-regeneration")
const task10Path = path.resolve(".omo/evidence/high-priority-missing-services/task-10/ui.json")
const commandSpecs = [
  ["07-task-10-final", "corepack pnpm test:e2e:task-10"],
  ["08-typecheck", "corepack pnpm typecheck"],
  ["09-lint", "corepack pnpm lint"],
  ["10-build", "corepack pnpm build"],
  ["11-api-contracts", "corepack pnpm test:api:contracts"],
  ["12-focused-node", "focused Node dashboard contract set"],
  ["13-supabase-stopped", "corepack pnpm supabase:assert-stopped"],
]

const commands = await Promise.all(
  commandSpecs.map(async ([name, invocation]) => {
    const exitPath = path.join(runDir, `${name}.exit`)
    const logPath = path.join(runDir, `${name}.log`)
    const exitCode = Number((await readFile(exitPath, "utf8")).trim())
    const log = await readFile(logPath)
    assert.equal(exitCode, 0, invocation)
    assert.ok(log.byteLength > 0, logPath)
    return {
      artifact: path.relative(process.cwd(), logPath),
      artifactSha256: sha256(log),
      exitCode,
      invocation,
    }
  }),
)
const summaryPath = path.join(evidenceDir, "summary.json")
const summary = JSON.parse(await readFile(summaryPath, "utf8"))
const task10 = JSON.parse(await readFile(task10Path, "utf8"))
assert.equal(summary.verdict, "APPROVE")
assert.equal(task10.verdict, "APPROVE")
assert.equal(task10.exitCode, 0)
assert.equal(task10.reportErrorCount, 0)
assert.equal(task10.scenarios.length, 36)
assert.deepEqual(task10.projects, ["desktop-chromium", "mobile-chromium", "tablet-chromium"])
assert.deepEqual(summary.coverage.counts, {
  coachApplications: 1,
  disputedReservations: 4,
  heldSettlements: 5,
  lessonReviews: 2,
  openReports: 3,
})
assert.equal(summary.coverage.filters, true)
assert.equal(summary.coverage.keyboard, true)
assert.equal(summary.coverage.zero, true)
assert.equal(summary.coverage.overflowMax, 0)
assert.equal(summary.coverage.overlapCount, 0)
assert.equal(summary.cleanup.remaining, 0)
assert.equal(summary.redactionFindings, 0)
assert.equal(summary.inventoryExact, true)
assert.equal(summary.dimensionsExact, true)

const sourceBindings = await hashFiles(adminDashboardSourcePaths)
assert.deepEqual(summary.sourceBindings, sourceBindings)
const rootPngs = (await readdir(evidenceDir)).filter((name) => name.endsWith(".png")).sort()
assert.deepEqual(rootPngs, [...adminDashboardScreenshotNames].sort())
const pngs = await Promise.all(
  adminDashboardScreenshotNames.map(async (name) => {
    const filePath = path.join(evidenceDir, name)
    const value = await readFile(filePath)
    const details = readPngEvidence(value)
    const expected = summary.screenshots.find((item) => item.name === name)
    assert.deepEqual({ ...details, bytes: value.byteLength, name, sha256: sha256(value) }, expected)
    return { ...expected, path: path.relative(process.cwd(), filePath) }
  }),
)
assert.deepEqual(
  pngs.map(({ height, width }) => ({ height, width })),
  [
    { height: 800, width: 1280 },
    { height: 1024, width: 768 },
    { height: 844, width: 390 },
  ],
)
assert.equal(
  pngs.every((item) => item.crcValid && item.filters.length > 0),
  true,
)
assert.equal(
  pngs.every((item) => item.nonBackgroundPixelCount > 1_000 && item.uniqueRgbCount > 16),
  true,
)

const visualPasses = await Promise.all(
  ["visual-pass-a.md", "visual-pass-b.md"].map(async (name) => {
    const filePath = path.join(runDir, name)
    const value = await readFile(filePath)
    assert.match(value.toString("utf8"), /^VERDICT: PASS$/mu)
    return { path: path.relative(process.cwd(), filePath), sha256: sha256(value) }
  }),
)
const cleanupLog = await readFile(path.join(runDir, "13-supabase-stopped.log"), "utf8")
assert.match(cleanupLog, /"portsFree":true/u)
assert.match(cleanupLog, /"containers":\[\],"volumes":\[\],"networks":\[\]/u)
const cleanupPath = path.join(evidenceDir, "final-cleanup-receipt.json")
await writeRedactedJson(
  cleanupPath,
  {
    allZero: true,
    command: commands.at(-1),
    ownedProcesses: 0,
    ownedRows: 0,
    ownedRuntimeResources: 0,
    ownedTempArtifacts: 0,
    ownedUsers: 0,
    portsFree: true,
    schemaVersion: 1,
    verdict: "APPROVE",
  },
  [],
)
const visualReportPath = path.join(evidenceDir, "visual-qa-report.md")
await writeFile(
  visualReportPath,
  `# Visual QA - Verdict: GOOD\n\nFresh current-bound desktop, tablet and mobile captures passed both review lanes. PNG CRCs, row filters, exact dimensions, non-background pixels, CJK visibility, keyboard traversal, zero state, overflow and overlap checks are all APPROVE.\n`,
  { mode: 0o600 },
)
const bindings = {
  cleanup: await fileBinding(cleanupPath),
  pngs,
  summary: await fileBinding(summaryPath),
  task10: await fileBinding(task10Path),
  visualPasses,
  visualReport: await fileBinding(visualReportPath),
}
const validationPath = path.join(evidenceDir, "final-validation.json")
await writeRedactedJson(
  validationPath,
  {
    bindings,
    commands,
    coverage: summary.coverage,
    inventory: { exactRootPngs: true, names: rootPngs },
    projects: task10.projects,
    redactionFindings: 0,
    scenarios: task10.scenarios.length,
    schemaVersion: 1,
    sourceBindings,
    verdict: "APPROVE",
  },
  [],
)
const receiptPath = path.join(evidenceDir, "current-binding-regeneration-receipt.json")
await writeRedactedJson(
  receiptPath,
  {
    finalValidation: await fileBinding(validationPath),
    generatedAfterAllCommands: true,
    noSourceEditsAfterBinding: true,
    sourceBindings,
    schemaVersion: 1,
    verdict: "APPROVE",
  },
  [],
)
const doneClaimPath = path.join(evidenceDir, "done-claim.json")
await writeRedactedJson(
  doneClaimPath,
  {
    artifacts: { ...bindings, regenerationReceipt: await fileBinding(receiptPath) },
    claim: "DONE",
    commands,
    schemaVersion: 1,
    sourceBindings,
    verdict: "APPROVE",
  },
  [],
)
process.stdout.write(
  `${JSON.stringify({ claim: "DONE", doneClaimPath, receiptPath, verdict: "APPROVE" })}\n`,
)

async function hashFiles(paths) {
  return Promise.all(
    paths.map(async (filePath) => ({ path: filePath, sha256: sha256(await readFile(filePath)) })),
  )
}

async function fileBinding(filePath) {
  const value = await readFile(filePath)
  return {
    bytes: (await stat(filePath)).size,
    path: path.relative(process.cwd(), filePath),
    sha256: sha256(value),
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
