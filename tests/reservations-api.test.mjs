import assert from "node:assert/strict"
import test from "node:test"

const baseUrl = process.env.SPOLINK_TEST_BASE_URL ?? "http://127.0.0.1:3006"
const sameOrigin = new URL(baseUrl).origin

test("reservation creation is bounded when auth or Supabase config is unavailable", async () => {
  const expectedFailure = await readExpectedAuthOrConfigFailure()
  const response = await fetch(`${baseUrl}/api/reservations`, {
    body: JSON.stringify({
      lessonId: "00000000-0000-4000-8000-000000000101",
      lessonScheduleId: "00000000-0000-4000-8000-000000000301",
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

test("reservation creation validates request body before Supabase access", async () => {
  const response = await fetch(`${baseUrl}/api/reservations`, {
    body: JSON.stringify({
      lessonId: "not-a-uuid",
      lessonScheduleId: "00000000-0000-4000-8000-000000000301",
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
  assert.deepEqual(body.error.details, ["lessonId must be a UUID"])
})

test("reservation creation reports malformed JSON as validation error", async () => {
  const response = await fetch(`${baseUrl}/api/reservations`, {
    body: '{"lessonId":',
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
  test(`reservation creation rejects ${name} Origin`, async () => {
    const headers = new Headers({ "content-type": "application/json" })
    if (origin) headers.set("origin", origin)

    const response = await fetch(`${baseUrl}/api/reservations`, {
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
  test(`reservation creation rejects ${name} Content-Type`, async () => {
    const headers = new Headers({ origin: sameOrigin })
    if (contentType) headers.set("content-type", contentType)

    const response = await fetch(`${baseUrl}/api/reservations`, {
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

async function readExpectedAuthOrConfigFailure() {
  const response = await fetch(`${baseUrl}/api/config/supabase`)
  const body = await response.json()

  return body.configured
    ? { code: "UNAUTHORIZED", status: 401 }
    : { code: "SUPABASE_NOT_CONFIGURED", status: 503 }
}
