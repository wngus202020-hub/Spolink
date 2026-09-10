import assert from "node:assert/strict"
import { readFile, rm, stat } from "node:fs/promises"
import test from "node:test"

import {
  approvedCommandPlan,
  buildGate0Checklist,
  classifyCommand,
  containsSensitiveMaterial,
  createFixture,
  fixtureNames,
  redactForEvidence,
  validateGate0ResourceInput,
  validateStagingContract,
  writeSafeEvidence,
} from "./contract.mjs"

test("forbidden command fixtures reject before a provider command starts", () => {
  const commands = [
    ["supabase", "db", "reset", "--linked"].join(" "),
    ["supabase", "migration", "down"].join(" "),
    ["supabase", "db", "push", "--linked", "--include-seed"].join(" "),
    ["rm", "-rf", "fixture-output"].join(" "),
    ["rewrite", "supabase/config.toml"].join(" "),
    ["gh", "repo", "view"].join(" "),
    ["vercel", "project", "ls"].join(" "),
    ["supabase", "link"].join(" "),
  ]
  for (const command of commands) {
    const result = classifyCommand(command)
    assert.equal(result.verdict, "REJECT")
    assert.equal(result.providerCommandsStarted, 0)
    assert.notEqual(result.category, "command-not-allow-listed")
  }
})

test("invalid contracts reject all required categories before provider start", () => {
  const base = validContract()
  const cases = [
    [{ ...base, SUPABASE_PROJECT_ID: "", expectedProjectUrl: "" }, "missing-project-id"],
    [
      { ...base, expectedStagingOrigin: base.expectedStagingOrigin.replace("https", "http") },
      "non-https-origin",
    ],
    [{ ...base, originCategory: "production" }, "production-origin-category"],
    [{ ...base, projectCategory: "production" }, "production-project-category"],
    [
      {
        ...base,
        expectedProjectUrl: base.expectedProjectUrl.replace(base.SUPABASE_PROJECT_ID, "other"),
      },
      "project-url-mismatch",
    ],
    [{ ...base, vercelEnvironment: "unexpected" }, "unknown-vercel-environment"],
    [{ ...base, productionProjectId: base.SUPABASE_PROJECT_ID }, "production-project-reuse"],
  ]
  for (const [contract, reason] of cases) {
    const result = validateStagingContract(contract)
    assert.equal(result.verdict, "REJECT")
    assert.equal(result.providerCommandsStarted, 0)
    assert.ok(result.reasons.includes(reason))
  }
})

test("valid contract approves only the staged plan and hash-gates migration push", () => {
  const result = approvedCommandPlan(validContract())
  assert.equal(result.verdict, "APPROVE")
  assert.equal(result.providerCommandsStarted, 0)
  assert.deepEqual(
    result.allowedCommandPlan.map((item) => item.category),
    ["contract-dry-run", "resource-list", "staging-smoke"],
  )
  assert.deepEqual(result.migrationPush, {
    category: "migration-push",
    requiresApprovedHash: true,
  })
})

test("redaction masks every required fixture and structured credentials", () => {
  for (const name of fixtureNames) {
    const raw = createFixture(name)
    const sanitized = redactForEvidence({ value: raw })
    assert.notEqual(sanitized.value, raw)
    assert.match(sanitized.value, /<redacted>/)
    assert.equal(containsSensitiveMaterial(sanitized), false)
  }

  const structured = redactForEvidence({
    password: ["fixture", "password"].join("-"),
    accessToken: ["fixture", "token"].join("-"),
    apiKey: ["fixture", "key"].join("-"),
  })
  assert.deepEqual(structured, {
    password: "<redacted>",
    accessToken: "<redacted>",
    apiKey: "<redacted>",
  })

  const tricky = redactForEvidence({
    header: "Authorization: Bearer opaque-secret",
    quoted: 'token="correct horse battery staple"',
    nested: { token: ["opaque-secret", { child: "still-secret" }] },
  })
  assert.deepEqual(tricky, {
    header: "<redacted>",
    quoted: "<redacted>",
    nested: { token: "<redacted>" },
  })
  assert.equal(containsSensitiveMaterial(tricky), false)
})

test("Gate 0 supports blocked, approved, and rejected resource states without identifiers", () => {
  const checklist = buildGate0Checklist()
  assert.equal(checklist.verdict, "BLOCKED")
  assert.equal(checklist.providerCommandsStarted, 0)
  assert.equal(checklist.identifiersRecorded, false)
  assert.ok(checklist.checks.every((check) => check.status === "MISSING"))
  assert.equal(containsSensitiveMaterial(checklist), false)

  const approved = buildGate0Checklist({
    githubPrivateRepository: true,
    supabaseStagingProject: true,
    vercelStagingTopology: true,
    smtpMailbox: true,
    cleanupAuthority: true,
    stableHttpsOrigin: true,
    resourceSeparation: true,
  })
  assert.equal(approved.verdict, "APPROVE")
  assert.ok(approved.checks.every((check) => check.status === "VERIFIED"))

  const rejected = buildGate0Checklist({ resourceSeparation: { status: "REJECTED" } })
  assert.equal(rejected.verdict, "REJECT")
  assert.ok(rejected.checks.some((check) => check.status === "REJECTED"))
})

test("Gate 0 readiness input accepts only the exact status-only contract", () => {
  const blocked = validateGate0ResourceInput(gate0Input("BLOCKED"))
  assert.equal(blocked.githubPrivateRepository.status, "BLOCKED")
  assert.equal(buildGate0Checklist(blocked).verdict, "BLOCKED")

  const verified = validateGate0ResourceInput(gate0Input("VERIFIED"))
  assert.equal(buildGate0Checklist(verified).verdict, "APPROVE")

  const rejected = validateGate0ResourceInput({
    ...gate0Input("VERIFIED"),
    resourceSeparation: "REJECTED",
  })
  assert.equal(buildGate0Checklist(rejected).verdict, "REJECT")

  assert.throws(
    () => validateGate0ResourceInput({ ...gate0Input("BLOCKED"), extra: "BLOCKED" }),
    /unknown gate 0 field/i,
  )
  const missing = gate0Input("BLOCKED")
  delete missing.smtpMailbox
  assert.throws(() => validateGate0ResourceInput(missing), /missing gate 0 field/i)
  assert.throws(
    () => validateGate0ResourceInput({ ...gate0Input("BLOCKED"), smtpMailbox: "PENDING" }),
    /invalid gate 0 status/i,
  )
  assert.throws(
    () =>
      validateGate0ResourceInput({ ...gate0Input("BLOCKED"), smtpMailbox: { status: "BLOCKED" } }),
    /status-only/i,
  )
})

test("approved Task 2 evidence includes schema and final-wave metadata", () => {
  const result = approvedCommandPlan(validContract())
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.case, "valid-contract")
  assert.equal(result.commandResults.length, 3)
  assert.equal(result.abortConditions.migrationPushWithoutApprovedHash, false)
  assert.deepEqual(result.cleanup, {
    required: false,
    reason: "offline contract test writes evidence only",
  })
  assert.deepEqual(result.redactionScan, { rawPatternCount: 0, verdict: "APPROVE" })
})

test("Vercel upload excludes local-only workspaces before filesystem traversal", async () => {
  const ignoreEntries = new Set(
    (await readFile(".vercelignore", "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  )

  assert.deepEqual(
    [".codegraph", ".next", ".omo", ".playwright-mcp", ".supabase", "supabase/.temp"].filter(
      (entry) => !ignoreEntries.has(entry),
    ),
    [],
  )
})

test("Vercel deploy uses the Next.js framework preset", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"))

  assert.equal(config.framework, "nextjs")
})

test("package scripts expose the hosted SMTP browser verifier", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"))

  assert.match(
    packageJson.scripts["staging:verify:smtp"],
    /tests\/staging-contract\/verify-smtp-auth-flow\.mjs/,
  )
})

test("safe evidence writer confines output, redacts values, and sets mode 0600", async () => {
  const output = `.omo/evidence/staging-contract/contract-test-${process.pid}.json`
  try {
    const raw = createFixture("email")
    await writeSafeEvidence(output, { schemaVersion: 1, note: raw, verdict: "BLOCKED" })
    const text = await readFile(output, "utf8")
    assert.doesNotMatch(text, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.match(text, /<redacted>/)
    if (process.platform !== "win32") assert.equal((await stat(output)).mode & 0o777, 0o600)
    await assert.rejects(
      writeSafeEvidence(`/tmp/contract-test-${process.pid}.json`, { verdict: "BLOCKED" }),
      /approved staging evidence directory/,
    )
  } finally {
    await rm(output, { force: true })
  }
})

function validContract() {
  const projectId = ["fixture", "staging", "ref123"].join("")
  return {
    SUPABASE_PROJECT_ID: projectId,
    expectedProjectUrl: ["https", "://", projectId, ".supabase.co"].join(""),
    expectedStagingOrigin: ["https", "://staging.example.invalid"].join(""),
    originCategory: "staging",
    projectCategory: "staging",
    productionProjectId: ["fixture", "production", "ref456"].join(""),
    vercelEnvironment: "staging",
  }
}

function gate0Input(status) {
  return {
    githubPrivateRepository: status,
    supabaseStagingProject: status,
    vercelStagingTopology: status,
    smtpMailbox: status,
    cleanupAuthority: status,
    stableHttpsOrigin: status,
    resourceSeparation: status,
  }
}
