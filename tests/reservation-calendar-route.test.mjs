import assert from "node:assert/strict"
import test from "node:test"

import {
  assertRejectedWithoutCalendarWork,
  calendarBytes,
  completeView,
  createHarness,
  learnerId,
  reservationId,
} from "./reservation-calendar-route-harness.mjs"
import {
  calendarRouteRuntimeCalls,
  configureCalendarRouteRuntime,
  loadReservationCalendarRoute,
} from "./reservation-calendar-route-runtime.mjs"

test("Given an authenticated owner with strict complete state, when GET runs, then calendar bytes and private download headers are returned", async () => {
  // Given
  const harness = createHarness()
  const request = new Request(`https://spolink.local/api/reservations/${reservationId}/calendar`)

  // When
  const response = await harness.handler(request, reservationId)

  // Then
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/calendar; charset=utf-8")
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="spolink-reservation.ics"',
  )
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(response.headers.get("set-cookie"), "sb-session=refreshed; Path=/; HttpOnly")
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), calendarBytes)
  assert.deepEqual(harness.calls.read, [[reservationId, learnerId]])
  assert.deepEqual(harness.calls.build, [
    {
      endAt: "2026-08-20T02:30:00.000Z",
      eventKey: reservationId,
      generatedAt: "2026-08-18T03:04:05.000Z",
      lessonTitle: "한강 테니스 입문",
      location: "서울숲 테니스장 1번 코트",
      preparationGuidance: "운동화와 물을 준비해 주세요.",
      startAt: "2026-08-20T01:00:00.000Z",
    },
  ])
})

test("Given a GET without Origin or JSON content type, when the owner downloads, then read authentication still succeeds", async () => {
  // Given
  const harness = createHarness()
  const request = new Request(`https://spolink.local/api/reservations/${reservationId}/calendar`, {
    headers: { Accept: "text/calendar" },
  })

  // When
  const response = await harness.handler(request, reservationId)

  // Then
  assert.equal(response.status, 200)
  assert.equal(harness.calls.auth, 1)
  assert.equal(harness.calls.read.length, 1)
})

test("Given Supabase is unconfigured, when GET runs, then it returns 503 before session or builder work", async () => {
  // Given
  const harness = createHarness({ configured: false })

  // When
  const response = await harness.handler(calendarRequest(), reservationId)

  // Then
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(harness.calls.session, 0)
  assertRejectedWithoutCalendarWork(harness)
})

test("Given refreshed cookies but no verified claims, when GET runs, then it returns 401 with the cookie and no read or builder", async () => {
  // Given
  const harness = createHarness({ user: null })

  // When
  const response = await harness.handler(calendarRequest(), reservationId)

  // Then
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("set-cookie"), "sb-session=refreshed; Path=/; HttpOnly")
  assertRejectedWithoutCalendarWork(harness)
})

test("Given verified claims and a malformed UUID, when GET runs, then it returns the same safe 404 without reading or building", async () => {
  // Given
  const harness = createHarness()

  // When
  const response = await harness.handler(calendarRequest("not-a-uuid"), "not-a-uuid")

  // Then
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("set-cookie"), "sb-session=refreshed; Path=/; HttpOnly")
  assertRejectedWithoutCalendarWork(harness)
})

test("Given a foreign or missing UUID, when GET runs, then both responses are byte-for-byte indistinguishable and never build", async () => {
  // Given
  const foreign = createHarness({ completion: { state: "not_found", viewModel: null } })
  const missing = createHarness({ completion: { state: "not_found", viewModel: null } })

  // When
  const foreignResponse = await foreign.handler(calendarRequest(), reservationId)
  const missingResponse = await missing.handler(calendarRequest(), reservationId)

  // Then
  assert.equal(foreignResponse.status, 404)
  assert.equal(missingResponse.status, 404)
  assert.equal(await foreignResponse.text(), await missingResponse.text())
  assert.deepEqual([...foreignResponse.headers], [...missingResponse.headers])
  assert.equal(foreign.calls.build.length, 0)
  assert.equal(missing.calls.build.length, 0)
})

test("Given pending, terminal, or mismatch state, when GET runs, then each returns 409 without calendar work", async () => {
  for (const state of ["pending", "terminal", "mismatch"]) {
    // Given
    const harness = createHarness({ completion: { state, viewModel: completeView() } })

    // When
    const response = await harness.handler(calendarRequest(), reservationId)

    // Then
    assert.equal(response.status, 409, state)
    assert.equal(harness.calls.build.length, 0, state)
  }
})

test("Given a read failure, when GET runs, then it returns 503 and never emits misleading calendar bytes", async () => {
  // Given
  const harness = createHarness({ completion: { state: "read_failure", viewModel: null } })

  // When
  const response = await harness.handler(calendarRequest(), reservationId)

  // Then
  assert.equal(response.status, 503)
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/u)
  assert.equal((await response.text()).includes("VCALENDAR"), false)
  assert.equal(harness.calls.build.length, 0)
})

test("Given a valid owner complete read whose calendar serializer throws, when GET runs, then it returns a safe cookie-preserving 503 without mutations", async () => {
  // Given
  const refreshedCookies = [
    "sb-access=refreshed; Path=/; HttpOnly",
    "sb-refresh=rotated; Path=/; HttpOnly",
  ]
  const harness = createHarness({
    buildError: new Error("calendar serializer failed"),
    responseCookies: refreshedCookies,
  })

  // When
  const response = await harness.handler(calendarRequest(), reservationId)
  const body = await response.text()

  // Then
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.deepEqual(response.headers.getSetCookie(), refreshedCookies)
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/u)
  assert.equal(
    body,
    '{"error":{"code":"CALENDAR_BUILD_FAILED","details":[],"message":"Calendar could not be created."}}',
  )
  assert.equal(body.includes("VCALENDAR"), false)
  assert.equal(body.includes("한강 테니스 입문"), false)
  assert.equal(body.includes("서울숲 테니스장"), false)
  assert.equal(harness.calls.read.length, 1)
  assert.equal(harness.calls.build.length, 1)
  assert.equal(harness.calls.mutation, 0)
})

test("Given strict complete state with stale schedule enrichment, when GET runs, then it returns 409 before the builder", async () => {
  // Given
  const harness = createHarness({
    completion: { state: "complete", viewModel: completeView({ startsAt: null }) },
  })

  // When
  const response = await harness.handler(calendarRequest(), reservationId)

  // Then
  assert.equal(response.status, 409)
  assert.equal(harness.calls.build.length, 0)
})

test("Given the compiled production route and cookie-aware owner session, when GET runs, then its exact calendar response comes from the runtime dependencies", async () => {
  // Given
  configureCalendarRouteRuntime({
    claims: { sub: learnerId },
    completion: { state: "complete", viewModel: completeView() },
    cookies: ["sb-session=runtime-refreshed; Path=/; HttpOnly"],
  })
  const route = await loadReservationCalendarRoute()
  const request = calendarRequest()

  // When
  const response = await route.GET(request, { params: Promise.resolve({ reservationId }) })

  // Then
  assert.equal(response.status, 200)
  assert.deepEqual(
    [...response.headers],
    [
      ["cache-control", "private, no-store"],
      ["content-disposition", 'attachment; filename="spolink-runtime.ics"'],
      ["content-type", "text/calendar; charset=utf-8"],
      ["set-cookie", "sb-session=runtime-refreshed; Path=/; HttpOnly"],
    ],
  )
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), calendarBytes)
  const calls = calendarRouteRuntimeCalls()
  assert.equal(calls.server, 1)
  assert.equal(calls.claims, 1)
  assert.deepEqual(calls.completion[0]?.slice(0, 2), [reservationId, learnerId])
  assert.equal(calls.completion[0]?.[2], Symbol.for("spolink.calendar-detail-reader"))
  assert.deepEqual(
    { ...calls.build[0], generatedAt: "<runtime-clock>" },
    {
      endAt: "2026-08-20T02:30:00.000Z",
      eventKey: reservationId,
      generatedAt: "<runtime-clock>",
      lessonTitle: "한강 테니스 입문",
      location: "서울숲 테니스장 1번 코트",
      preparationGuidance: "운동화와 물을 준비해 주세요.",
      startAt: "2026-08-20T01:00:00.000Z",
    },
  )
})

test("Given the compiled production route and refreshed unauthenticated session, when GET runs, then its exact safe response preserves cookies", async () => {
  // Given
  configureCalendarRouteRuntime({
    claims: null,
    completion: { state: "complete", viewModel: completeView() },
    cookies: ["sb-session=anonymous-refresh; Path=/; HttpOnly"],
  })
  const route = await loadReservationCalendarRoute()

  // When
  const response = await route.GET(calendarRequest(), {
    params: Promise.resolve({ reservationId }),
  })

  // Then
  assert.equal(response.status, 401)
  assert.deepEqual(
    [...response.headers],
    [
      ["cache-control", "private, no-store"],
      ["content-type", "application/json; charset=utf-8"],
      ["set-cookie", "sb-session=anonymous-refresh; Path=/; HttpOnly"],
    ],
  )
  assert.equal(
    await response.text(),
    '{"error":{"code":"UNAUTHENTICATED","details":[],"message":"Authentication required."}}',
  )
  assert.deepEqual(calendarRouteRuntimeCalls(), {
    build: [],
    claims: 1,
    completion: [],
    server: 1,
  })
})

test("Given the compiled route adapter, when params resolve, then it delegates the original Request and returns the handler response unchanged", async () => {
  // Given
  const request = calendarRequest()
  const delegated = []
  const expected = new Response("teapot", {
    headers: { "Set-Cookie": "adapter=observed; Path=/", "X-Adapter": "calendar" },
    status: 418,
  })
  const route = await loadReservationCalendarRoute(async (...args) => {
    delegated.push(args)
    return expected
  })

  // When
  const response = await route.GET(request, { params: Promise.resolve({ reservationId }) })

  // Then
  assert.equal(response, expected)
  assert.deepEqual(delegated, [[request, reservationId]])
  assert.equal(response.status, 418)
  assert.deepEqual(
    [...response.headers],
    [
      ["content-type", "text/plain;charset=UTF-8"],
      ["set-cookie", "adapter=observed; Path=/"],
      ["x-adapter", "calendar"],
    ],
  )
  assert.equal(await response.text(), "teapot")
})

test("Given the compiled route adapter and a rejecting handler, when GET runs, then the same error propagates", async () => {
  // Given
  const request = calendarRequest()
  const sentinel = new Error("adapter sentinel")
  const route = await loadReservationCalendarRoute(async () => {
    throw sentinel
  })

  // When / Then
  await assert.rejects(
    route.GET(request, { params: Promise.resolve({ reservationId }) }),
    (error) => error === sentinel,
  )
})

function calendarRequest(id = reservationId) {
  return new Request(`https://spolink.local/api/reservations/${id}/calendar`)
}
