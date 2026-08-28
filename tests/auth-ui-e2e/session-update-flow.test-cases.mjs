import assert from "node:assert/strict"
import test from "node:test"

import {
  makeSupabaseHarness,
  readJson,
  routeRequest,
  setCookieHeader,
  TEST_SESSION_ID,
  TEST_USER_ID,
  testSecret,
} from "./session-route-helpers.mjs"

test("same-origin validation accepts the managed loopback browser Origin", async () => {
  const { hasSameOrigin } = await import("../../lib/auth/route-security.ts")
  const request = new Request("http://localhost:4321/auth/update-password/submit", {
    headers: {
      host: "127.0.0.1:4321",
      origin: "http://127.0.0.1:4321",
    },
    method: "POST",
  })

  assert.equal(hasSameOrigin(request), true)
})

test("same-origin validation rejects attacker-controlled matching Host and Origin", async () => {
  const { hasSameOrigin } = await import("../../lib/auth/route-security.ts")
  const request = new Request("http://localhost:4321/auth/update-password/submit", {
    headers: {
      host: "attacker.example:4321",
      origin: "http://attacker.example:4321",
    },
    method: "POST",
  })

  assert.equal(hasSameOrigin(request), false)
})

test("same-origin validation rejects malformed and mismatched origins", async () => {
  const { hasSameOrigin } = await import("../../lib/auth/route-security.ts")
  const cases = [
    { name: "missing", origin: null },
    { name: "malformed", origin: "://invalid-origin" },
    { name: "path-bearing", origin: "http://localhost:4321/not-an-origin" },
    { name: "cross-origin", origin: "http://attacker.example:4321" },
    { name: "protocol mismatch", origin: "https://127.0.0.1:4321" },
    { name: "port mismatch", origin: "http://127.0.0.1:4322" },
    { name: "public-host alias", origin: "http://www.service.example:4321" },
  ]

  for (const testCase of cases) {
    const headers = new Headers()
    if (testCase.origin !== null) headers.set("origin", testCase.origin)
    if (testCase.name === "public-host alias") headers.set("host", "www.service.example:4321")
    const url =
      testCase.name === "public-host alias"
        ? "http://service.example:4321/auth/update-password/submit"
        : "http://localhost:4321/auth/update-password/submit"
    const request = new Request(url, { headers, method: "POST" })
    assert.equal(hasSameOrigin(request), false, testCase.name)
  }
})

test("same-origin validation accepts an exact public request URL Origin", async () => {
  const { hasSameOrigin } = await import("../../lib/auth/route-security.ts")
  const request = new Request("https://service.example/account", {
    headers: { origin: "https://service.example" },
    method: "POST",
  })

  assert.equal(hasSameOrigin(request), true)
})

test("same-origin validation accepts only same-protocol same-port loopback aliases", async () => {
  const { hasSameOrigin } = await import("../../lib/auth/route-security.ts")
  for (const [url, origin] of [
    ["http://localhost:4321/submit", "http://127.0.0.1:4321"],
    ["http://127.0.0.1:4321/submit", "http://[::1]:4321"],
    ["https://[::1]/submit", "https://localhost"],
  ]) {
    assert.equal(hasSameOrigin(new Request(url, { headers: { origin }, method: "POST" })), true)
  }
})

test("update submit consumes grant before provider update and clears recovery marker", async () => {
  const { createUpdatePasswordHandler } = await import("../../lib/auth/update-password-route.ts")
  const { createRecoveryToken, sha256HexUtf8 } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const marker = createRecoveryToken({ secret, sessionId: TEST_SESSION_ID, sub: TEST_USER_ID })
  const harness = makeSupabaseHarness({ secret })

  const response = await createUpdatePasswordHandler(harness.dependencies)(
    routeRequest("/auth/update-password/submit", {
      body: { password: "new-password", passwordConfirmation: "new-password" },
      cookie: `spolink_recovery=${marker.token}`,
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await readJson(response), { data: { updated: true } })
  assert.deepEqual(harness.calls, [
    "config",
    "secret",
    "client",
    "claims",
    "rpc:consume_password_recovery_grant",
    "updateUser",
  ])
  assert.equal(harness.rpcArgs.checked_token_hash, sha256HexUtf8(marker.jti))
  assert.match(setCookieHeader(response), /spolink_recovery=;/)
})

test("replayed update submit marker fails before provider update", async () => {
  const { createUpdatePasswordHandler } = await import("../../lib/auth/update-password-route.ts")
  const { createRecoveryToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const marker = createRecoveryToken({ secret, sessionId: TEST_SESSION_ID, sub: TEST_USER_ID })
  const harness = makeSupabaseHarness({ rpcData: false, secret })

  const response = await createUpdatePasswordHandler(harness.dependencies)(
    routeRequest("/auth/update-password/submit", {
      body: { password: "new-password", passwordConfirmation: "new-password" },
      cookie: `spolink_recovery=${marker.token}`,
    }),
  )

  assert.equal(response.status, 403)
  assert.equal(harness.calls.includes("updateUser"), false)
})

test("wrong user update submit marker fails before consume or provider update", async () => {
  const { createUpdatePasswordHandler } = await import("../../lib/auth/update-password-route.ts")
  const { createRecoveryToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const marker = createRecoveryToken({
    secret,
    sessionId: TEST_SESSION_ID,
    sub: "00000000-0000-4000-8000-000000000099",
  })
  const harness = makeSupabaseHarness({ secret })

  const response = await createUpdatePasswordHandler(harness.dependencies)(
    routeRequest("/auth/update-password/submit", {
      body: { password: "new-password", passwordConfirmation: "new-password" },
      cookie: `spolink_recovery=${marker.token}`,
    }),
  )

  assert.equal(response.status, 403)
  assert.equal(harness.calls.includes("rpc:consume_password_recovery_grant"), false)
  assert.equal(harness.calls.includes("updateUser"), false)
})

test("wrong session update submit marker fails before consume or provider update", async () => {
  const { createUpdatePasswordHandler } = await import("../../lib/auth/update-password-route.ts")
  const { createRecoveryToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const marker = createRecoveryToken({ secret, sessionId: "other-session", sub: TEST_USER_ID })
  const harness = makeSupabaseHarness({ secret })

  const response = await createUpdatePasswordHandler(harness.dependencies)(
    routeRequest("/auth/update-password/submit", {
      body: { password: "new-password", passwordConfirmation: "new-password" },
      cookie: `spolink_recovery=${marker.token}`,
    }),
  )

  assert.equal(response.status, 403)
  assert.equal(harness.calls.includes("rpc:consume_password_recovery_grant"), false)
  assert.equal(harness.calls.includes("updateUser"), false)
})

test("parallel consume update submit allows one request and rejects the competing replay", async () => {
  const { createUpdatePasswordHandler } = await import("../../lib/auth/update-password-route.ts")
  const { createRecoveryToken } = await import("../../lib/auth/flow-token.ts")
  const secret = testSecret()
  const marker = createRecoveryToken({ secret, sessionId: TEST_SESSION_ID, sub: TEST_USER_ID })
  let consumed = false
  const harness = makeSupabaseHarness({
    rpc: async () => {
      if (consumed) return { data: false, error: null }
      consumed = true
      return { data: true, error: null }
    },
    secret,
  })
  const handler = createUpdatePasswordHandler(harness.dependencies)
  const request = () =>
    routeRequest("/auth/update-password/submit", {
      body: { password: "new-password", passwordConfirmation: "new-password" },
      cookie: `spolink_recovery=${marker.token}`,
    })

  const responses = await Promise.all([handler(request()), handler(request())])
  const statuses = responses.map((response) => response.status).sort()

  assert.deepEqual(statuses, [200, 403])
  assert.equal(harness.calls.filter((call) => call === "updateUser").length, 1)
})
