import assert from "node:assert/strict"
import test from "node:test"

import {
  createBookingReservation,
  isReservableUuid,
} from "../lib/reservations/booking-request-client.ts"

const request = Object.freeze({
  lessonId: "00000000-0000-4000-8000-000000000101",
  lessonScheduleId: "00000000-0000-4000-8000-000000000301",
})

const responseBody = Object.freeze({
  data: {
    id: "00000000-0000-4000-8000-000000000401",
    paymentExpiresAt: "2026-08-01T09:10:00+09:00",
    reservedPriceAmount: 45_000,
    status: "pending_payment",
  },
})

test("booking request client creates one pending reservation and payment handoff URL", async () => {
  const calls = []
  const result = await createBookingReservation(request, async (input, init) => {
    calls.push({ input, init })

    return jsonResponse(responseBody, 201)
  })

  assert.equal(result.status, "success")
  assert.deepEqual(result.reservation, responseBody.data)
  assert.equal(result.paymentHref, `/reservations/${responseBody.data.id}/payment`)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, "/api/reservations")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.cache, "no-store")
  assert.equal(calls[0].init.credentials, "same-origin")
  assert.equal(calls[0].init.headers["Content-Type"], "application/json")
  assert.deepEqual(JSON.parse(calls[0].init.body), request)
})

test("booking request client never calls payment prepare from confirmation screen", async () => {
  const touchedUrls = []
  const result = await createBookingReservation(request, async (input) => {
    touchedUrls.push(String(input))

    return jsonResponse(responseBody, 201)
  })

  assert.equal(result.status, "success")
  assert.deepEqual(touchedUrls, ["/api/reservations"])
  assert.equal(
    touchedUrls.some((url) => url.includes("/api/payments/prepare")),
    false,
  )
})

test("booking request client maps documented recoverable errors", async () => {
  for (const [code, message] of [
    ["CAPACITY_EXCEEDED", "선택한 일정의 예약 가능 인원이 없어요. 다른 일정을 선택해요."],
    ["CONFLICT", "예약 상태가 변경됐어요. 다시 확인해요."],
    ["UNAUTHORIZED", "로그인이 필요해요. 다시 로그인해요."],
  ]) {
    const result = await createBookingReservation(request, async () =>
      jsonResponse({ error: { code, details: [], message: "Server message" } }, 409),
    )

    assert.deepEqual(result, { code, message, status: "failure" })
  }
})

test("booking request client rejects non-UUID demo ids before API mutation", async () => {
  let called = false
  const result = await createBookingReservation(
    { lessonId: "tennis-gangnam", lessonScheduleId: "tennis-gangnam-today" },
    async () => {
      called = true

      return jsonResponse(responseBody, 201)
    },
  )

  assert.equal(called, false)
  assert.deepEqual(result, {
    code: "UNRESERVABLE_DEMO_LESSON",
    message:
      "현재 표시된 데모 레슨은 실제 예약을 만들 수 없어요. 실제 예약 가능한 일정을 다시 선택해요.",
    status: "failure",
  })
  assert.equal(isReservableUuid("tennis-gangnam"), false)
  assert.equal(isReservableUuid(request.lessonId), true)
})

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  })
}
