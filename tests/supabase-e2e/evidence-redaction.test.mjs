import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  appendRedactedEvidence,
  appendRedactedJsonLine,
  writeRedactedJson,
} from "./evidence-redaction.mjs"

const sha256 = "0".repeat(64)

test("writes one schema-valid compact evidence line without wrapper", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  try {
    const evidencePath = path.join(dir, "task-1.log")
    const record = {
      schemaVersion: 1,
      timestamp: "2026-07-16T00:00:00.000Z",
      entryType: "command",
      command: "node --test tests/supabase-e2e/evidence-redaction.test.mjs",
      exitCode: 0,
      redactedOutputPath: ".omo/evidence/task-1-output.log",
      redactedOutputSha256: sha256,
      db: { notApplicable: true, reason: "redaction helper has no database surface" },
      http: { notApplicable: true, reason: "redaction helper has no HTTP surface" },
      cleanup: { command: "rm -rf tmp", exitCode: 0, proofSha256: sha256 },
      verdict: null,
    }

    await appendRedactedEvidence(evidencePath, record, [])

    const mode = (await stat(evidencePath)).mode & 0o777
    assert.equal(mode, 0o600)
    assert.equal(await readFile(evidencePath, "utf8"), `${JSON.stringify(record)}\n`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("rejects malformed evidence records before writing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  try {
    const evidencePath = path.join(dir, "task-1.log")
    await assert.rejects(
      appendRedactedEvidence(
        evidencePath,
        {
          schemaVersion: 1,
          timestamp: "2026-07-16T00:00:00.000Z",
          entryType: "command",
          command: "node --test",
          exitCode: 0,
          redactedOutputPath: ".omo/evidence/out.log",
          redactedOutputSha256: sha256,
          db: { notApplicable: true, reason: "none" },
          http: { notApplicable: true, reason: "none" },
          cleanup: { command: "true", exitCode: 0, proofSha256: sha256 },
          verdict: null,
          extra: "rejected",
        },
        [],
      ),
      /unknown evidence field/i,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("writes exact redacted JSON and append-only JSONL ledgers", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  try {
    const jsonPath = path.join(dir, "receipt.json")
    const jsonlPath = path.join(dir, "ledger.jsonl")
    const receipt = {
      schemaVersion: 1,
      runId: "run-1",
      createdAt: "2026-07-16T00:00:00.000Z",
      dockerOwnership: "preexisting",
    }
    const ledger = {
      todo: 1,
      filesAdded: ["tests/supabase-e2e/evidence-redaction.mjs"],
      filesModified: [],
      filesDeleted: [],
      packageDependencyDelta: {
        production: { added: [], removed: [], changed: [] },
        development: { added: [], removed: [], changed: [] },
      },
      lockfileHash: sha256,
    }

    await writeRedactedJson(jsonPath, receipt, [])
    await appendRedactedJsonLine(jsonlPath, ledger, [])

    assert.deepEqual(JSON.parse(await readFile(jsonPath, "utf8")), receipt)
    assert.equal(await readFile(jsonlPath, "utf8"), `${JSON.stringify(ledger)}\n`)
    assert.equal((await stat(jsonPath)).mode & 0o777, 0o600)
    assert.equal((await stat(jsonlPath)).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("redacts generic UUIDs from structured evidence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  try {
    const evidencePath = path.join(dir, "uuid.json")
    await writeRedactedJson(evidencePath, { fixtureId: "00000000-0000-4000-8000-000000000402" }, [])
    assert.deepEqual(JSON.parse(await readFile(evidencePath, "utf8")), {
      fixtureId: "<redacted-uuid>",
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("rejects leaked evidence while allowing explicit redacted placeholders", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  const evidencePath = path.join(dir, "redacted.json")
  const jwt =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEifQ.signature"
  const rejectedValues = [
    jwt,
    "sb_publishable_abcdefghijklmnopqrstuvwxyz",
    "sb_secret_abcdefghijklmnopqrstuvwxyz",
    "Authorization: Bearer abcdefghijk",
    "authorization: Basic abcdefghijk",
    "Cookie: sb-access-token=abc",
    "Set-Cookie: sb-refresh-token=abc",
    "postgresql://postgres:password@127.0.0.1:54322/postgres",
    "learner@spolink.test",
    "generated-password-1",
    "prefix\nCookie: <redacted>; raw=value",
    "prefix\nSet-Cookie: <redacted>, raw=value",
  ]
  try {
    await writeRedactedJson(evidencePath, { value: "cookie value is <redacted>" }, [])
    for (const value of rejectedValues) {
      await assert.rejects(
        writeRedactedJson(evidencePath, { value }, ["generated-password-1"]),
        /unredacted/i,
      )
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("rejects sensitive structured keys recursively", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "spolink-redaction-"))
  const evidencePath = path.join(dir, "structured.json")
  try {
    const cases = [
      { Cookie: "sb-access-token=structured-cookie" },
      { "set-cookie": "sb-refresh-token=structured-cookie" },
      { AUTHORIZATION: "Bearer structured-token" },
      { apiKey: "structured-api-key" },
      { accessToken: "structured-access-token" },
      { databaseUrl: "postgres://postgres:password@127.0.0.1:54322/postgres" },
      { nested: [{ headers: { authorization: "Bearer nested-token" } }] },
      { env: { SUPABASE_SERVICE_ROLE_KEY: "structured-secret" } },
      { mapLike: [["password", "structured-password"]] },
    ]

    for (const value of cases) {
      await assert.rejects(writeRedactedJson(evidencePath, value, []), /unredacted/i)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("exports exactly the three approved evidence writer APIs", async () => {
  const module = await import("./evidence-redaction.mjs")
  assert.deepEqual(Object.keys(module).sort(), [
    "appendRedactedEvidence",
    "appendRedactedJsonLine",
    "writeRedactedJson",
  ])
})
