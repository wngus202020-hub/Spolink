import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { fixedIds } from "./fixtures.mjs"
import { appendTodo8RunEvidence } from "./task8/evidence.mjs"
import { assertQaHoldRequest, assertSingleOwnedNext, buildChildEnv } from "./task8/helpers.mjs"
import { redactText, runCaptured } from "./task8/process.mjs"
import {
  assertCancellationBody,
  assertConfiguredBody,
  assertMetadata,
  assertUnauthorizedBody,
} from "./task8/qa-assertions.mjs"

test("Todo8 child env allowlists omit secret and Supabase variables by command class", () => {
  const parent = {
    HOME: "/home/test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "parent-public-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://hosted.example",
    PATH: "/bin",
    SPOLINK_EDGE_SECRET: "edge-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret",
    TMPDIR: "/tmp",
    TOSS_PAYMENTS_SECRET_KEY: "toss-secret",
  }

  assert.deepEqual(buildChildEnv("test-api", parent, { baseUrl: "http://127.0.0.1:3006" }), {
    HOME: "/home/test",
    NODE_ENV: "test",
    PATH: "/bin",
    SPOLINK_TEST_BASE_URL: "http://127.0.0.1:3006",
    TMPDIR: "/tmp",
  })
  assert.deepEqual(buildChildEnv("next-unconfigured", parent, {}), {
    HOME: "/home/test",
    PATH: "/bin",
    TMPDIR: "/tmp",
  })
  assert.deepEqual(
    buildChildEnv("next-configured", parent, {
      anonKey: "local-anon",
      apiUrl: "http://127.0.0.1:54321",
    }),
    {
      HOME: "/home/test",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-anon",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      PATH: "/bin",
      TMPDIR: "/tmp",
    },
  )
  assert.deepEqual(buildChildEnv("typecheck", parent, {}), {
    HOME: "/home/test",
    NODE_ENV: "test",
    PATH: "/bin",
    TMPDIR: "/tmp",
  })
  assert.deepEqual(buildChildEnv("build", parent, {}), {
    HOME: "/home/test",
    NODE_ENV: "production",
    PATH: "/bin",
    TMPDIR: "/tmp",
  })
})

test("Todo8 QA hold accepts only 120 seconds and external absolute metadata", () => {
  assert.deepEqual(assertQaHoldRequest({ seconds: undefined, metadataPath: undefined }), {
    enabled: false,
  })
  assert.deepEqual(
    assertQaHoldRequest({
      metadataPath: path.join(os.tmpdir(), "spolink-task8-metadata.json"),
      repoRoot: process.cwd(),
      seconds: "120",
    }),
    {
      enabled: true,
      metadataPath: path.join(os.tmpdir(), "spolink-task8-metadata.json"),
      seconds: 120,
    },
  )
  assert.throws(() => assertQaHoldRequest({ seconds: "60", metadataPath: "/tmp/x" }), /120/)
  assert.throws(
    () => assertQaHoldRequest({ seconds: "120", metadataPath: "relative.json" }),
    /absolute/,
  )
  assert.throws(
    () =>
      assertQaHoldRequest({
        metadataPath: path.join(process.cwd(), "metadata.json"),
        repoRoot: process.cwd(),
        seconds: "120",
      }),
    /outside/,
  )
})

test("Todo8 QA body assertions require exact public contracts", () => {
  assertConfiguredBody({ configured: true, invalidKeys: [], missingKeys: [] })
  assertUnauthorizedBody({
    error: { code: "UNAUTHORIZED", details: [], message: "Authentication required." },
  })
  assertCancellationBody(
    {
      data: {
        cancelledAt: "2026-07-17T12:00:00.000+00:00",
        refund: {
          amount: 7000,
          id: "00000000-0000-4000-8000-00000000abcd",
          status: "requested",
        },
        reservationId: "00000000-0000-4000-8000-000000000402",
        status: "cancelled_by_user",
      },
    },
    "00000000-0000-4000-8000-000000000402",
    "cancelled_by_user",
    7000,
    "requested",
  )

  assert.throws(() => assertConfiguredBody({ configured: true, extra: [] }), /exact/)
  assert.throws(() => assertUnauthorizedBody({ error: { code: "UNAUTHORIZED" } }), /exact/)
})

test("Todo8 QA metadata is mode 0600 and contains exactly four external absolute paths", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-task8-test."))
  try {
    const metadataPath = path.join(tempRoot, "metadata.json")
    const cookieJarPath = path.join(tempRoot, "cookies.txt")
    const releasePath = path.join(tempRoot, "release.json")
    await writeFile(
      cookieJarPath,
      "# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tsb-local-auth-token\ttest-value\n",
      { mode: 0o600 },
    )
    await writeFile(releasePath, '{"released":false}\n', { mode: 0o600 })
    await writeFile(
      metadataPath,
      JSON.stringify({
        baseUrl: "http://127.0.0.1:3006",
        cookieJarPath,
        releasePath,
        reservationId: "00000000-0000-4000-8000-000000000402",
      }),
      { mode: 0o600 },
    )
    assert.equal((await stat(metadataPath)).mode & 0o777, 0o600)
    assert.deepEqual(await assertMetadata(metadataPath, process.cwd()), {
      baseUrl: "http://127.0.0.1:3006",
      cookieJarPath,
      releasePath,
      reservationId: "00000000-0000-4000-8000-000000000402",
    })
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
})

test("Todo8 ownership guard rejects more than one live owned Next child", () => {
  assertSingleOwnedNext([])
  assertSingleOwnedNext([{ pid: 10, stopped: false }])
  assertSingleOwnedNext([
    { pid: 10, stopped: true },
    { pid: 11, stopped: false },
  ])
  assert.throws(
    () =>
      assertSingleOwnedNext([
        { pid: 10, stopped: false },
        { pid: 11, stopped: false },
      ]),
    /one Next child/,
  )
})

test("Todo8 command output redacts case-insensitive structured secret keys", () => {
  const redacted = redactText(
    JSON.stringify({
      AUTHORIZATION: "Bearer command-token",
      Cookie: "sb-access-token=command-cookie",
      nested: [{ "set-cookie": "sb-refresh-token=command-cookie" }],
      runPassword: "command-password",
    }),
  )

  assert.equal(redacted.includes("command-token"), false)
  assert.equal(redacted.includes("command-cookie"), false)
  assert.equal(redacted.includes("command-password"), false)
})

test("Todo8 captured command output redacts fixture identity and caller run secrets", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-task8-capture."))
  const outputPath = path.join(tempRoot, "captured.json")
  const runSecret = "caller-run-secret-value-402"
  try {
    const script = [
      `process.stdout.write("learner@spolink.test ${runSecret} local-seed-402 ${fixedIds.cancellableReservation}\\n")`,
      `process.stderr.write("provider_order_id=spolink_${fixedIds.cancellableReservation} ${runSecret}\\n")`,
    ].join(";")
    const result = await runCaptured({
      args: ["-e", script],
      command: process.execPath,
      controls: { baseUrl: "http://127.0.0.1:1", runSecrets: [runSecret] },
      envKind: "e2e",
      outputPath,
    })
    assert.equal(result.exitCode, 0)

    const captured = await readFile(outputPath, "utf8")
    assert.equal(captured.includes(runSecret), false)
    assert.equal(captured.includes("learner@spolink.test"), false)
    assert.equal(captured.includes("local-seed-402"), false)
    assert.equal(captured.includes(fixedIds.cancellableReservation), false)
    assert.equal(captured.includes(`spolink_${fixedIds.cancellableReservation}`), false)
    assert.match(captured, /<redacted-run-secret:[a-f0-9]{64}>/)
    assert.match(captured, /<redacted-fixture-email>/)
    assert.match(captured, /<redacted-provider-key>/)
    assert.match(captured, /<redacted-provider-order>/)
    assert.match(captured, /<redacted-uuid>/)
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
})

test("Todo8 aggregate receipt verdict matches every child exit code", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "spolink-task8-verdict."))
  try {
    const cleanupPath = path.join(tempRoot, "assert-stopped.json")
    await writeFile(cleanupPath, '{"stopped":true}\n', { mode: 0o600 })
    for (const [exitCode, verdict] of [
      [0, "APPROVE"],
      [1, "REJECT"],
      [42, "REJECT"],
    ]) {
      const summaryPath = path.join(tempRoot, `summary-${exitCode}.json`)
      const evidenceLog = path.join(tempRoot, `receipt-${exitCode}.jsonl`)
      await writeFile(summaryPath, "{}\n", { mode: 0o600 })
      await appendTodo8RunEvidence({
        evidenceLog,
        exitCode,
        outputDir: tempRoot,
        qaSuccess: null,
        summaryPath,
      })
      const receipt = JSON.parse(await readFile(evidenceLog, "utf8"))
      assert.equal(receipt.entryType, "final-verdict")
      assert.equal(receipt.exitCode, exitCode)
      assert.equal(receipt.verdict, verdict)
      assert.equal((await stat(evidenceLog)).mode & 0o777, 0o600)
    }
  } finally {
    await rm(tempRoot, { force: true, recursive: true })
  }
})
