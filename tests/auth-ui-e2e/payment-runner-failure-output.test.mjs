import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import * as runnerOutput from "./payment-runner-failure-output.mjs"

test("payment runner retains mode-0600 redacted child failure output without credentials", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spolink-payment-runner-output-"))
  const outputPath = path.join(directory, "summary.json")
  const rawSecret = "sb_secret_runner-contract-value"
  const rawEmail = "payment-runner-user@spolink.test"

  try {
    const receipt = await runnerOutput.writeRedactedFailureOutput(outputPath, {
      stderr: `authorization: Bearer secret-token ${rawSecret}`,
      stdout: `failed for ${rawEmail} at postgres://user:password@127.0.0.1:54322/db`,
    })
    const [stdout, stderr, stdoutStats, stderrStats] = await Promise.all([
      readFile(receipt.stdoutPath, "utf8"),
      readFile(receipt.stderrPath, "utf8"),
      stat(receipt.stdoutPath),
      stat(receipt.stderrPath),
    ])

    assert.doesNotMatch(stdout, new RegExp(rawEmail, "u"))
    assert.doesNotMatch(stdout, /postgres:\/\//u)
    assert.doesNotMatch(stderr, new RegExp(rawSecret, "u"))
    assert.doesNotMatch(stderr, /secret-token/u)
    assert.match(stdout, /<redacted-email>/u)
    assert.match(stderr, /<redacted/u)
    assert.equal(stdoutStats.mode & 0o777, 0o600)
    assert.equal(stderrStats.mode & 0o777, 0o600)
    assert.match(receipt.stdoutSha256, /^[a-f0-9]{64}$/u)
    assert.match(receipt.stderrSha256, /^[a-f0-9]{64}$/u)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("payment runner redacts arbitrary emails without deleting surrounding failure observables", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "spolink-payment-runner-email-output-"))
  const outputPath = path.join(directory, "summary.json")
  const jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjMifQ.signature"
  const publishableKey = "sb_publishable_runner-contract-value"
  const secretKey = "sb_secret_runner-contract-value"

  try {
    const receipt = await runnerOutput.writeRedactedFailureOutput(outputPath, {
      stderr: [
        "Cookie: session=runner-cookie",
        "Set-Cookie: refresh=runner-refresh; HttpOnly",
        "Authorization: Bearer runner-token",
        "error: code=17; contact person@example.com.",
      ].join("\n"),
      stdout: [
        "ERROR payment=42: person@example.com, Mixed.Case+tag@sub.example.co.kr; ops@sample.org; 지원@예시.한국!",
        `jwt=${jwt} keys=${publishableKey},${secretKey}`,
        "database=postgresql://user:password@127.0.0.1:54322/payment?sslmode=disable",
      ].join("\n"),
    })
    const [stdout, stderr] = await Promise.all([
      readFile(receipt.stdoutPath, "utf8"),
      readFile(receipt.stderrPath, "utf8"),
    ])

    assert.equal(
      stdout,
      [
        "ERROR payment=42: <redacted-email>, <redacted-email>; <redacted-email>; <redacted-email>!",
        "jwt=<redacted-jwt> keys=<redacted-supabase-key>,<redacted-supabase-key>",
        "database=<redacted-postgres-url>",
      ].join("\n"),
    )
    assert.equal(
      stderr,
      [
        "Cookie: <redacted>",
        "Set-Cookie: <redacted>",
        "Authorization: <redacted>",
        "error: code=17; contact <redacted-email>.",
      ].join("\n"),
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("payment runner parses only complete redacted numeric browser observables", () => {
  const valid = {
    browserConsoleErrorCount: 0,
    forbiddenRequestCount: 0,
    pageErrorCount: 0,
    prepareRequestCount: 1,
    project: "desktop-chromium",
    readyPaymentRowCount: 1,
    requestFailureCount: 0,
  }
  const stdout = [
    `noise`,
    `PAYMENT_E2E_OBSERVABLE_REDACTED ${JSON.stringify(valid)}`,
    `PAYMENT_E2E_OBSERVABLE_REDACTED {"project":"mobile-chromium"}`,
  ].join("\n")

  assert.deepEqual(runnerOutput.readPaymentObservables(stdout), [valid])
})
