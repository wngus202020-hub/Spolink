import assert from "node:assert/strict"
import test from "node:test"

import {
  makeSupabaseHarness,
  namedConfigError,
  readJson,
  routeRequest,
  setCookieHeader,
  TEST_ORIGIN,
  testSecret,
} from "./session-route-helpers.mjs"

test("cross-origin recovery start rejects before config secret or provider work", async () => {
  const { createRecoveryStartHandler } = await import("../../lib/auth/recovery-start-route.ts")
  const harness = makeSupabaseHarness()

  const response = await createRecoveryStartHandler(harness.dependencies)(
    routeRequest("/auth/recovery/start", {
      body: { email: "USER@Example.COM" },
      origin: "https://evil.test",
    }),
  )

  assert.equal(response.status, 403)
  assert.deepEqual(harness.calls, [])
})

test("missing config recovery start returns 503 before secret or provider work", async () => {
  const { createRecoveryStartHandler } = await import("../../lib/auth/recovery-start-route.ts")
  const harness = makeSupabaseHarness({ configured: false })

  const response = await createRecoveryStartHandler(harness.dependencies)(
    routeRequest("/auth/recovery/start", { body: { email: "user@example.com" } }),
  )

  assert.equal(response.status, 503)
  assert.deepEqual(harness.calls, ["config"])
})

test("missing config auth-flow secret recovery start returns 503 before provider work", async () => {
  const { createRecoveryStartHandler } = await import("../../lib/auth/recovery-start-route.ts")
  const harness = makeSupabaseHarness({ secretError: namedConfigError() })

  const response = await createRecoveryStartHandler(harness.dependencies)(
    routeRequest("/auth/recovery/start", { body: { email: "user@example.com" } }),
  )

  assert.equal(response.status, 503)
  assert.deepEqual(harness.calls, ["config", "secret"])
})

test("provider 4xx recovery start normalizes provider output and accepts request", async () => {
  const response = await recoveryStartWithProviderFailure({ status: 400 })

  assert.equal(response.status, 202)
  assert.deepEqual(await readJson(response), { data: { accepted: true } })
})

test("provider 5xx recovery start normalizes provider output and accepts request", async () => {
  const response = await recoveryStartWithProviderFailure({ status: 500 })

  assert.equal(response.status, 202)
  assert.deepEqual(await readJson(response), { data: { accepted: true } })
})

test("timeout recovery start normalizes AbortError and accepts request", async () => {
  const response = await recoveryStartWithProviderException(
    new DOMException("The operation timed out.", "AbortError"),
  )

  assert.equal(response.status, 202)
  assert.deepEqual(await readJson(response), { data: { accepted: true } })
})

test("network recovery start normalizes TypeError and accepts request", async () => {
  const response = await recoveryStartWithProviderException(new TypeError("network failed"))

  assert.equal(response.status, 202)
  assert.deepEqual(await readJson(response), { data: { accepted: true } })
})

test("code verifier callback failure preserves existing session cookies and clears verifier markers", async () => {
  const { createCallbackHandler } = await import("../../lib/auth/callback-route.ts")
  const base = "sb-abcdefghijklmnop-auth-token"
  const harness = makeSupabaseHarness({ exchangeError: new Error("bad code") })

  const response = await createCallbackHandler(harness.dependencies)(
    routeRequest("/auth/callback?code=bad", {
      cookie: `${base}.0=existing; ${base}-code-verifier=verifier; spolink_recovery=old`,
      method: "GET",
      origin: null,
    }),
  )

  const cookies = setCookieHeader(response)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get("location"), "/auth/login?error=auth-link-invalid")
  assert.equal(cookies.includes(`${base}.0=;`), false)
  assert.match(cookies, /sb-abcdefghijklmnop-auth-token-code-verifier=;/)
  assert.match(cookies, /spolink_recovery=;/)
})

test("callback recovery success issues a fresh recovery grant distinct from intent jti", async () => {
  const { createCallbackHandler } = await import("../../lib/auth/callback-route.ts")
  const { createRecoveryIntentToken, sha256HexUtf8 } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret)
  const harness = makeSupabaseHarness({ secret })

  const response = await createCallbackHandler(harness.dependencies)(
    routeRequest("/auth/callback?next=/auth/update-password&code=ok", {
      cookie: `sb-abcdefghijklmnop-auth-token-code-verifier=verifier; spolink_recovery_intent=${intent.token}`,
      method: "GET",
      origin: null,
    }),
  )

  assert.equal(response.status, 303)
  assert.equal(response.headers.get("location"), "/auth/update-password")
  assert.match(harness.rpcArgs.checked_token_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(harness.rpcArgs.checked_token_hash, sha256HexUtf8(intent.jti))
  assert.match(setCookieHeader(response), /spolink_recovery=/)
})

test("callback recovery accepts the percent-encoded next value emitted by hosted auth", async () => {
  const { createCallbackHandler } = await import("../../lib/auth/callback-route.ts")
  const { createRecoveryIntentToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret)
  const harness = makeSupabaseHarness({ secret })

  const response = await createCallbackHandler(harness.dependencies)(
    routeRequest("/auth/callback?next=%2Fauth%2Fupdate-password&code=ok", {
      cookie: `sb-abcdefghijklmnop-auth-token-code-verifier=verifier; spolink_recovery_intent=${intent.token}`,
      method: "GET",
      origin: null,
    }),
  )

  assert.equal(response.status, 303)
  assert.equal(response.headers.get("location"), "/auth/update-password")
  assert.match(setCookieHeader(response), /spolink_recovery=/)
})

test("callback recovery rejects duplicate next values before issuing a recovery grant", async () => {
  const { createCallbackHandler } = await import("../../lib/auth/callback-route.ts")
  const { createRecoveryIntentToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const intent = createRecoveryIntentToken(secret)
  const harness = makeSupabaseHarness({ secret })

  const response = await createCallbackHandler(harness.dependencies)(
    routeRequest(
      "/auth/callback?next=%2Fauth%2Fupdate-password&next=https%3A%2F%2Fevil.test&code=ok",
      {
        cookie: `sb-abcdefghijklmnop-auth-token-code-verifier=verifier; spolink_recovery_intent=${intent.token}`,
        method: "GET",
        origin: null,
      },
    ),
  )

  assert.equal(response.status, 303)
  assert.equal(response.headers.get("location"), "/lessons")
  assert.doesNotMatch(setCookieHeader(response), /spolink_recovery=[^;]/)
})

test("logout module surface is POST-only without an executable GET handler", async () => {
  const routeModule = await import("../../app/auth/logout/route.ts")

  assert.equal(Object.hasOwn(routeModule, "POST"), true)
  assert.equal(Object.hasOwn(routeModule, "GET"), false)
})

test("logout cross-origin request rejects before config or sign-out", async () => {
  const { createLogoutHandler } = await import("../../lib/auth/logout-route.ts")
  const harness = makeSupabaseHarness()

  const response = await createLogoutHandler(harness.dependencies)(
    routeRequest("/auth/logout", { origin: "https://evil.test" }),
  )

  assert.equal(response.status, 403)
  assert.deepEqual(harness.calls, [])
})

test("logout clears configured project cookies locally and leaves foreign project cookies intact", async () => {
  const { createLogoutHandler } = await import("../../lib/auth/logout-route.ts")
  const harness = makeSupabaseHarness()

  const response = await createLogoutHandler(harness.dependencies)(
    routeRequest("/auth/logout", {
      cookie:
        "sb-abcdefghijklmnop-auth-token.0=session; sb-other-auth-token=other; spolink_recovery=x",
    }),
  )

  assert.equal(response.status, 303)
  assert.deepEqual(harness.signOutArgs, { scope: "local" })
  assert.match(setCookieHeader(response), /sb-abcdefghijklmnop-auth-token\.0=;/)
  assert.equal(setCookieHeader(response).includes("sb-other-auth-token=;"), false)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
})

async function recoveryStartWithProviderFailure(resetError) {
  const { createRecoveryStartHandler } = await import("../../lib/auth/recovery-start-route.ts")
  const harness = makeSupabaseHarness({ resetError })
  const response = await createRecoveryStartHandler(harness.dependencies)(
    routeRequest("/auth/recovery/start", { body: { email: " USER@Example.COM " } }),
  )

  assert.equal(harness.resetArgs.email, "user@example.com")
  assert.equal(
    harness.resetArgs.requestOptions.redirectTo,
    `${TEST_ORIGIN}/auth/callback?next=/auth/update-password`,
  )
  assert.match(setCookieHeader(response), /spolink_recovery_intent=/)
  return response
}

async function recoveryStartWithProviderException(resetError) {
  const { createRecoveryStartHandler } = await import("../../lib/auth/recovery-start-route.ts")
  const harness = makeSupabaseHarness({ resetThrows: resetError })
  const response = await createRecoveryStartHandler(harness.dependencies)(
    routeRequest("/auth/recovery/start", { body: { email: " USER@Example.COM " } }),
  )

  assert.equal(harness.resetArgs.email, "user@example.com")
  assert.match(setCookieHeader(response), /spolink_recovery_intent=/)
  return response
}
