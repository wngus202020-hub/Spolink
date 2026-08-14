import assert from "node:assert/strict"
import test from "node:test"

import { preparePayment } from "../lib/payments/payment-prepare-client.ts"

const reservationId = "00000000-0000-4000-8000-000000000401"
const preparedPayment = Object.freeze({
  amount: 50_000,
  orderName: "입문 테니스 레슨",
  paymentId: "00000000-0000-4000-8000-000000000501",
  provider: "toss",
  providerOrderId: `spolink_${reservationId}`,
})

test("payment prepare client sends only reservationId with protected browser request options", async () => {
  const calls = []
  const result = await preparePayment(reservationId, async (input, init) => {
    calls.push({ init, input })
    return jsonResponse({ data: preparedPayment }, 201)
  })

  assert.deepEqual(result, { payment: preparedPayment, status: "success" })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, "/api/payments/prepare")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.cache, "no-store")
  assert.equal(calls[0].init.credentials, "same-origin")
  assert.equal(calls[0].init.headers["Content-Type"], "application/json")
  assert.deepEqual(JSON.parse(calls[0].init.body), { reservationId })
  assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)), ["reservationId"])
})

test("payment prepare client maps documented API errors", async () => {
  for (const code of [
    "UNAUTHORIZED",
    "PROFILE_REQUIRED",
    "RESERVATION_EXPIRED",
    "NOT_FOUND",
    "FORBIDDEN",
    "CONFLICT",
  ]) {
    const result = await preparePayment(reservationId, async () =>
      jsonResponse({ error: { code, details: [], message: "Server message" } }, 409),
    )

    assert.equal(result.status, "failure")
    assert.equal(result.code, code)
    assert.equal(typeof result.message, "string")
    assert.notEqual(result.message.length, 0)
  }
})

test("payment prepare client maps fetch rejection to a network error", async () => {
  const result = await preparePayment(reservationId, async () => {
    throw new Error("offline")
  })

  assert.deepEqual(result, {
    code: "NETWORK_ERROR",
    message: "연결이 원활하지 않아요. 잠시 후 다시 시도해요.",
    status: "failure",
  })
})

test("payment prepare client rejects invalid provider and payment response fields", async () => {
  for (const invalidPayment of [
    { ...preparedPayment, amount: 0 },
    { ...preparedPayment, amount: 50_000.5 },
    { ...preparedPayment, orderName: " " },
    { ...preparedPayment, paymentId: "not-a-uuid" },
    { ...preparedPayment, provider: "other" },
    { ...preparedPayment, providerOrderId: " " },
  ]) {
    const result = await preparePayment(reservationId, async () =>
      jsonResponse({ data: invalidPayment }, 201),
    )

    assert.equal(result.status, "failure")
    assert.equal(result.code, "INVALID_RESPONSE")
  }
})

test("payment prepare client rejects malformed success and unknown error responses", async () => {
  const malformedSuccess = await preparePayment(
    reservationId,
    async () => new Response("not json", { status: 201 }),
  )
  const unknownFailure = await preparePayment(reservationId, async () =>
    jsonResponse({ error: { code: "INTERNAL_ERROR" } }, 500),
  )

  assert.equal(malformedSuccess.status, "failure")
  assert.equal(malformedSuccess.code, "INVALID_RESPONSE")
  assert.equal(unknownFailure.status, "failure")
  assert.equal(unknownFailure.code, "INVALID_RESPONSE")
})

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
