import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { allCountersAreZero } from "./mypage-reviews-evidence.mjs"
import {
  inspectOutOfRangeRecovery,
  runMalformedRunner,
  semanticObligationDiagnostics,
} from "./mypage-reviews-runner-contract-helpers.mjs"

const runnerPath = new URL("./run-mypage-reviews.mjs", import.meta.url)
const specPath = new URL("./mypage-reviews.spec.ts", import.meta.url)
const fixturesPath = new URL("./mypage-reviews-fixtures.ts", import.meta.url)
const evidencePath = new URL("./mypage-reviews-evidence.mjs", import.meta.url)
const mutationTarget = process.env["SPOLINK_MYPAGE_REVIEWS_MUTATION_TARGET"] ?? null

test("Given Todo 6 sources, when ownership is inspected, then the managed runner owns lifecycle and exact evidence", async () => {
  const [runner, spec, fixtures, evidence] = await Promise.all([
    readFile(runnerPath, "utf8"),
    readFile(specPath, "utf8"),
    readFile(fixturesPath, "utf8"),
    readFile(evidencePath, "utf8"),
  ])

  assert.match(runner, /import \{ withConfiguredAuthMode \} from "\.\/lifecycle\.mjs"/u)
  assert.match(runner, /await withConfiguredAuthMode\(/u)
  assert.match(runner, /enableConfirmations: false/u)
  assert.match(runner, /mypage-reviews\.spec\.ts/u)
  assert.match(runner, /mobile-chromium[\s\S]*tablet-chromium[\s\S]*desktop-chromium/u)
  assert.match(runner, /cleanupReceiptPath/u)
  assert.match(runner, /sourceManifest/u)
  assert.match(runner, /assertNoSensitiveEvidence/u)
  assert.match(runner, /SPOLINK_MYPAGE_REVIEWS_INJECT_CHILD_FAILURE/u)
  assert.doesNotMatch(runner, /supabase:(?:start|stop|reset)|next dev|next start/u)

  assert.match(spec, /try\s*\{[\s\S]*finally\s*\{/u)
  assert.match(spec, /restoreAuthenticatedReviewSelect/u)
  assert.match(spec, /cleanupReviewFixtures/u)
  assert.match(spec, /\/api\/reviews/u)
  assert.match(spec, /\/api\/admin\/reviews\/\$\{[^}]+\}\/hide/u)
  assert.match(spec, /\/api\/lessons\/\$\{[^}]+\}\/reviews/u)

  assert.match(fixtures, /export const fixtureManifest/u)
  assert.match(fixtures, /21/u)
  assert.match(fixtures, /status[^\n]+deleted/u)
  assert.match(fixtures, /revoke select on table public\.reviews from authenticated/iu)
  assert.match(fixtures, /grant select on table public\.reviews to authenticated/iu)
  assert.match(fixtures, /cleanupCounters/u)
  assert.match(fixtures, /messages/u)

  assert.match(evidence, /sha256/u)
  assert.match(evidence, /sourceFiles/u)
  assert.match(evidence, /assertNoSensitiveEvidence/u)
})

test("Given fixture-only coverage, when sources are scanned, then no app backdoor or leaked credential channel exists", async () => {
  const sources = await Promise.all(
    [runnerPath, specPath, fixturesPath, evidencePath].map((file) => readFile(file, "utf8")),
  )
  const combined = sources.join("\n")

  assert.doesNotMatch(combined, /page\.route\(|route\.fulfill\(|x-spolink-|fixture[_-]?mode/iu)
  assert.doesNotMatch(combined, /NEXT_PUBLIC_[A-Z_]*FIXTURE|SPOLINK_[A-Z_]*FIXTURE/gu)
  assert.doesNotMatch(combined, /console\.log\([^\n]*(?:email|password|token|cookie|dbUrl)/iu)
  assert.doesNotMatch(combined, /serviceRoleKey\s*[,}]/u)
})

test("Given the actual spec import graph, when it is compiled, then every semantic obligation resolves", () => {
  assert.deepEqual(semanticObligationDiagnostics(mutationTarget), [])
})

test("Given in-memory scenario and assertion mutations, when the actual spec graph is compiled, then both mutations fail", () => {
  for (const target of ["scenario", "assertions"]) {
    const diagnostics = semanticObligationDiagnostics(target)
    assert.ok(diagnostics.length > 0)
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === 2305))
  }
})

test("Given the out-of-range browser helper, when its AST is inspected, then page 999 recovers through the first-page link", async () => {
  assert.deepEqual(await inspectOutOfRangeRecovery(), {
    firstPageLinkClick: true,
    pageOneUrlAssertion: true,
    requestedUrl: "/mypage/reviews?page=999",
  })
})

test("Given no project receipts, when cleanup truth is computed, then zero cleanup is not claimed", () => {
  assert.equal(allCountersAreZero([]), false)
})

test("Given an outside evidence path, when the actual runner starts, then it exits promptly without a vacuous cleanup claim", {
  timeout: 8_000,
}, async () => {
  const result = await runMalformedRunner(fileURLToPath(runnerPath))
  try {
    assert.equal(result.timedOut, false)
    assert.ok(result.durationMs < 4_000)
    assert.equal(result.exitCode, 1)
    assert.equal(result.signal, null)
    assert.equal(result.summary, null)
    assert.match(result.stderr, /Evidence path/u)
  } finally {
    await result.cleanup()
  }
})
