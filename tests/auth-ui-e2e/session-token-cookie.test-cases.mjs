import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { routeRequest, TEST_SUPABASE_URL, testSecret } from "./session-route-helpers.mjs"

test("auth flow secret parser accepts only base64url secrets decoding to 32 bytes", async () => {
  const { getAuthFlowSecretStatus } = await import("../../lib/auth/flow-config.ts")
  const valid = Buffer.alloc(32, 3).toString("base64url")

  assert.equal(getAuthFlowSecretStatus(undefined).reason, "missing")
  assert.equal(getAuthFlowSecretStatus("not+base64").reason, "malformed")
  assert.equal(
    getAuthFlowSecretStatus(Buffer.alloc(31, 1).toString("base64url")).reason,
    "too_short",
  )
  assert.equal(getAuthFlowSecretStatus(valid).configured, true)
})

test("code verifier cookie matching is scoped to the configured project base only", async () => {
  const { findSupabaseCookieNames, getSupabaseAuthCookieBase } = await import(
    "../../lib/auth/cookies.ts"
  )
  const base = getSupabaseAuthCookieBase(TEST_SUPABASE_URL)
  const request = routeRequest("/auth/logout", {
    cookie: [
      `${base}=root`,
      `${base}.0=chunk`,
      `${base}.01=bad`,
      `${base}-code-verifier=verifier`,
      `prefix-${base}=bad`,
      `${base}-suffix=bad`,
      "sb-other-auth-token=bad",
      "spolink_recovery=marker",
    ].join("; "),
  })

  assert.equal(base, "sb-abcdefghijklmnop-auth-token")
  assert.deepEqual(findSupabaseCookieNames(request, TEST_SUPABASE_URL, "all"), [
    base,
    `${base}.0`,
    `${base}-code-verifier`,
  ])
  assert.deepEqual(findSupabaseCookieNames(request, TEST_SUPABASE_URL, "verifier"), [
    `${base}-code-verifier`,
  ])
})

test("tampered recovery marker fails when its HMAC signature changes", async () => {
  const { createRecoveryToken, verifyRecoveryToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const recovery = createRecoveryToken({ secret, sessionId: "session-1", sub: "user-1", now: 1 })
  const [payloadSegment] = recovery.token.split(".")
  const tampered = `${payloadSegment}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`

  assert.equal(verifyRecoveryToken(tampered, secret, 2).status, "failure")
})

test("noncanonical recovery intent fails when payload key order changes", async () => {
  const { createRecoveryIntentToken, verifyRecoveryIntentToken } = await import(
    "../../lib/auth/flow-token.ts"
  )
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret, 1_800_000_000)
  const noncanonicalPayload = Buffer.from(
    JSON.stringify({
      purpose: "password_recovery_intent",
      v: 1,
      jti: intent.jti,
      iat: 1_800_000_000,
      exp: 1_800_000_600,
    }),
  ).toString("base64url")
  const noncanonicalSignature = createHmac("sha256", secret)
    .update(noncanonicalPayload)
    .digest("base64url")

  assert.equal(
    verifyRecoveryIntentToken(`${noncanonicalPayload}.${noncanonicalSignature}`, secret).status,
    "failure",
  )
})

test("expired recovery intent and marker fail after the fixed lifetime", async () => {
  const {
    createRecoveryIntentToken,
    createRecoveryToken,
    verifyRecoveryIntentToken,
    verifyRecoveryToken,
  } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret, 1_800_000_000)
  const recovery = createRecoveryToken({
    secret,
    sessionId: "session-1",
    sub: "user-1",
    now: 1_800_000_000,
  })

  assert.equal(verifyRecoveryIntentToken(intent.token, secret, 1_800_000_601).status, "failure")
  assert.equal(verifyRecoveryToken(recovery.token, secret, 1_800_000_601).status, "failure")
})

test("wrong purpose recovery marker rejects an intent token at update boundary", async () => {
  const { createRecoveryIntentToken, verifyRecoveryToken } = await import(
    "../../lib/auth/flow-token.ts"
  )
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret, 1_800_000_000)

  assert.equal(verifyRecoveryToken(intent.token, secret, 1_800_000_001).status, "failure")
})

test("signed recovery marker preserves session and user claims plus stable hash output", async () => {
  const { createRecoveryToken, sha256HexUtf8, verifyRecoveryToken } = await import(
    "../../lib/auth/flow-token.ts"
  )
  const secret = testSecret()
  const recovery = createRecoveryToken({ secret, sessionId: "session-1", sub: "user-1", now: 1 })
  const verified = verifyRecoveryToken(recovery.token, secret, 2)

  assert.equal(verified.status, "success")
  if (verified.status === "success") {
    assert.equal(verified.payload.sessionId, "session-1")
    assert.equal(verified.payload.sub, "user-1")
  }
  assert.equal(
    sha256HexUtf8("grant-jti"),
    "5e71e6a7d96d3464e29cc910e17db7f1a014310763c1536c71952a4b75070201",
  )
})
