import assert from "node:assert/strict"
import test from "node:test"

const baseUrl = process.env.SPOLINK_TEST_BASE_URL ?? "http://127.0.0.1:3006"
const sameOrigin = new URL(baseUrl).origin

test("payment prepare is bounded when auth or Supabase config is unavailable", async () => {
  const expectedFailure = await readExpectedAuthOrConfigFailure()
  const response = await fetch(`${baseUrl}/api/payments/prepare`, {
    body: JSON.stringify({
      reservationId: "00000000-0000-4000-8000-000000000401",
    }),
    headers: {
      "content-type": "application/json",
      origin: sameOrigin,
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, expectedFailure.status)
  assert.equal(body.error.code, expectedFailure.code)
})

test("payment prepare validates request body before Supabase access", async () => {
  const response = await fetch(`${baseUrl}/api/payments/prepare`, {
    body: JSON.stringify({
      reservationId: "not-a-uuid",
    }),
    headers: {
      "content-type": "application/json; charset=utf-8",
      origin: sameOrigin,
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.error.code, "VALIDATION_ERROR")
  assert.deepEqual(body.error.details, ["reservationId must be a UUID"])
})

test("payment prepare reports malformed JSON as validation error", async () => {
  const response = await fetch(`${baseUrl}/api/payments/prepare`, {
    body: '{"reservationId":',
    headers: {
      "content-type": "application/json; charset=utf-8",
      origin: sameOrigin,
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.error.code, "VALIDATION_ERROR")
  assert.deepEqual(body.error.details, [])
})

for (const [name, origin] of [
  ["missing", null],
  ["cross-origin", "https://attacker.example"],
]) {
  test(`payment prepare rejects ${name} Origin`, async () => {
    const headers = new Headers({ "content-type": "application/json" })
    if (origin) headers.set("origin", origin)

    const response = await fetch(`${baseUrl}/api/payments/prepare`, {
      body: JSON.stringify({}),
      headers,
      method: "POST",
    })
    const body = await response.json()

    assert.equal(response.status, 403)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(body, {
      error: { code: "FORBIDDEN", details: [], message: "Same-origin request required." },
    })
  })
}

for (const [name, contentType] of [
  ["missing", null],
  ["non-JSON", "text/plain"],
]) {
  test(`payment prepare rejects ${name} Content-Type`, async () => {
    const headers = new Headers({ origin: sameOrigin })
    if (contentType) headers.set("content-type", contentType)

    const response = await fetch(`${baseUrl}/api/payments/prepare`, {
      body: new TextEncoder().encode("{}"),
      headers,
      method: "POST",
    })
    const body = await response.json()

    assert.equal(response.status, 415)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(body, {
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        details: [],
        message: "Content-Type must be application/json.",
      },
    })
  })
}

test("payment confirm is bounded when server or provider config is unavailable", async () => {
  const expectedFailure = readExpectedConfirmConfigFailure()
  const response = await fetch(`${baseUrl}/api/payments/confirm`, {
    body: JSON.stringify({
      amount: 50000,
      providerOrderId: "spolink_00000000-0000-4000-8000-000000000401",
      providerPaymentKey: "payment-key",
      reservationId: "00000000-0000-4000-8000-000000000401",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, expectedFailure.status)
  assert.equal(body.error.code, expectedFailure.code)
})

test("payment confirm validates request body before provider access", async () => {
  const response = await fetch(`${baseUrl}/api/payments/confirm`, {
    body: JSON.stringify({
      amount: 50000,
      providerOrderId: "spolink_00000000-0000-4000-8000-000000000401",
      providerPaymentKey: "payment-key",
      reservationId: "not-a-uuid",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.error.code, "VALIDATION_ERROR")
  assert.deepEqual(body.error.details, ["reservationId must be a UUID"])
})

test("payment confirm reports malformed JSON as validation error", async () => {
  const response = await fetch(`${baseUrl}/api/payments/confirm`, {
    body: '{"reservationId":',
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  })
  const body = await response.json()

  assert.equal(response.status, 422)
  assert.equal(body.error.code, "VALIDATION_ERROR")
  assert.deepEqual(body.error.details, [])
})

async function readExpectedAuthOrConfigFailure() {
  const response = await fetch(`${baseUrl}/api/config/supabase`)
  const body = await response.json()

  return body.configured
    ? { code: "UNAUTHORIZED", status: 401 }
    : { code: "SUPABASE_NOT_CONFIGURED", status: 503 }
}

function readExpectedConfirmConfigFailure() {
  if (!process.env.SPOLINK_EDGE_SECRET) {
    return { code: "EDGE_SECRET_NOT_CONFIGURED", status: 503 }
  }

  const supabaseConfigured =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseConfigured) {
    return { code: "SUPABASE_NOT_CONFIGURED", status: 503 }
  }

  return process.env.TOSS_PAYMENTS_SECRET_KEY
    ? { code: "PAYMENT_VERIFICATION_FAILED", status: 400 }
    : { code: "EXTERNAL_PROVIDER_ERROR", status: 502 }
}
