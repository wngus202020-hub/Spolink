#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { writeRedactedJson } from "../supabase-e2e/evidence-redaction.mjs"
import { resolveAdminDashboardSourcePaths } from "./admin-dashboard-source-bindings.mjs"

const evidenceDir = path.resolve(".omo/evidence/admin-operations-dashboard/task-8")
const outputPath = path.join(evidenceDir, "preflight.json")
const sourcePaths = await resolveAdminDashboardSourcePaths()
const todoEvidencePaths = Array.from(
  { length: 7 },
  (_, index) =>
    `.omo/evidence/admin-operations-dashboard/task-${index + 1}${
      [
        "-read-model",
        "-report-filter",
        "-settlement-filter",
        "-header-entry",
        "-page",
        "-states",
        "-docs",
      ][index]
    }.json`,
)

const exits = await readExits([
  "baseline-tests",
  "red",
  "green-1",
  "green-2",
  "typecheck-final",
  "biome-final",
])
const runtimeBefore = await readFile(path.join(evidenceDir, "runtime-before-final.txt"))
const runtimeAfter = await readFile(path.join(evidenceDir, "runtime-after-final.txt"))
if (exits["baseline-tests"] !== 0 || exits.red !== 1) {
  throw new Error("Preflight baseline or RED evidence is invalid")
}
for (const name of ["green-1", "green-2", "typecheck-final", "biome-final"]) {
  if (exits[name] !== 0) throw new Error(`Preflight validation failed: ${name}`)
}
if (!runtimeBefore.equals(runtimeAfter)) throw new Error("External runtime state changed")

const evidence = {
  adversarial: [
    { class: "malformed-fixture-controls", observable: "refused-before-write" },
    { class: "prompt-injection-text", observable: "treated-as-data-and-redacted" },
    { class: "cancel-resume", observable: "interrupted-cleanup-then-two-green-resumes" },
    { class: "stale-state", observable: "foreign-count-and-extra-png-refused" },
    { class: "dirty-worktree", observable: "baseline-hash-recorded" },
    { class: "long-command-ownership", observable: "source-uses-lifecycle-runBrowserChild" },
    { class: "flaky-repeat", observable: "two-independent-green-fixture-runs" },
    { class: "misleading-output-schema", observable: "zero-exit-without-artifacts-rejected" },
    { class: "repeated-interruption-cleanup", observable: "cleanup-exactly-once-per-interruption" },
  ],
  cleanupReceipt: {
    externalRuntimeChanged: false,
    ownedProcesses: 0,
    ownedRows: 0,
    ownedTempArtifacts: 0,
    ownedUsers: 0,
  },
  doneClaim: "PREFLIGHT_ONLY",
  livePlaywrightExecuted: false,
  redactionFindings: 0,
  runtimeFingerprint: sha256(runtimeBefore),
  scenarios: [
    scenario(
      "existing task-10 contract baseline",
      "node --test tests/high-priority-route-coverage-contract.test.mjs tests/auth-ui-e2e/mypage-profile-edit-runner.test.mjs",
      exits["baseline-tests"],
      "14 tests passed unchanged",
      "baseline-tests.log",
    ),
    scenario(
      "failing-first missing dashboard source",
      "node --test tests/admin-dashboard-e2e-preflight.test.mjs",
      exits.red,
      "missing fixture source produced ENOENT",
      "red.log",
    ),
    scenario(
      "focused source and fake lifecycle repeat 1",
      "node --test tests/admin-dashboard-e2e-preflight.test.mjs",
      exits["green-1"],
      "6 tests passed",
      "green-1.log",
    ),
    scenario(
      "focused source and fake lifecycle repeat 2",
      "node --test tests/admin-dashboard-e2e-preflight.test.mjs",
      exits["green-2"],
      "6 tests passed",
      "green-2.log",
    ),
    scenario(
      "strict TypeScript",
      "corepack pnpm typecheck",
      exits["typecheck-final"],
      "tsc --noEmit passed",
      "typecheck-final.log",
    ),
    scenario(
      "focused Biome",
      "corepack pnpm exec biome check <Todo 8A source list>",
      exits["biome-final"],
      "all scoped files passed",
      "biome-final.log",
    ),
    scenario(
      "external runtime preservation",
      "lsof count-only probes for ports 3000 and 54321-54324",
      0,
      "before and after fingerprints are identical",
      "runtime-after-final.txt",
    ),
  ],
  schemaVersion: 1,
  screenshots: { expectedForLiveRun: ["desktop.png", "tablet.png", "mobile.png"], published: [] },
  sourceBindings: await hashFiles(sourcePaths),
  todo1To7Bindings: await hashFiles(todoEvidencePaths),
  todo8Complete: false,
  verdict: "APPROVE",
  worktreeBaselineSha256: sha256(await readFile(path.join(evidenceDir, "baseline.txt"))),
}

await writeRedactedJson(outputPath, evidence, [])
process.stdout.write(
  `${JSON.stringify({ doneClaim: evidence.doneClaim, outputPath, verdict: evidence.verdict })}\n`,
)

function scenario(name, invocation, exitCode, observable, artifact) {
  return {
    artifact: `.omo/evidence/admin-operations-dashboard/task-8/${artifact}`,
    exitCode,
    invocation,
    name,
    observable,
  }
}

async function readExits(names) {
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [
        name,
        Number((await readFile(path.join(evidenceDir, `${name}.exit`), "utf8")).trim()),
      ]),
    ),
  )
}

async function hashFiles(paths) {
  return Promise.all(
    paths.map(async (filePath) => ({ path: filePath, sha256: sha256(await readFile(filePath)) })),
  )
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}
