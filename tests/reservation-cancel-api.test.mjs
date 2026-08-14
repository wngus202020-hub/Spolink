import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCancelReservationRequest,
  runCancelReservationWorkflow,
} from "../lib/reservations/cancel-reservation-api.ts"
import { createCancelReservationRouteAdapter } from "../lib/reservations/cancel-reservation-route-adapter.ts"

const reservationId = "58d5e76e-6d64-4bd1-a85f-5fd0d3efeb81"
const userId = "00000000-0000-4000-8000-000000000001"
const cancellation = {
  cancelled_at: "2026-07-15T02:30:00.000Z",
  refund_amount: 7000,
  refund_id: "0663fdbf-b5c2-45e4-aada-65e6eb4a5bdc",
  refund_status: "requested",
  reservation_id: reservationId,
  reservation_status: "cancelled_by_user",
}

function cancellationRequest(
  body = JSON.stringify({ reason: "Schedule changed" }),
  headers = { "content-type": "application/json", origin: "http://localhost" },
) {
  return new Request(`http://localhost/api/reservations/${reservationId}/cancel`, {
    body,
    headers,
    method: "POST",
  })
}

function createHarness({ authenticated = true, configured = true, rpcResult } = {}) {
  const calls = {
    auth: 0,
    config: 0,
    profile: 0,
    rpc: [],
    session: 0,
  }
  const adapter = createCancelReservationRouteAdapter({
    createSession: async (responseHeaders) => {
      calls.session += 1
      responseHeaders.append("set-cookie", "spolink-session=refreshed; Path=/; HttpOnly")

      return {
        cancelReservation: async (args) => {
          calls.rpc.push(args)

          return rpcResult ?? { cancellation, errorCode: null }
        },
        getCurrentProfile: async (targetUserId) => {
          calls.profile += 1

          return { errorCode: null, profile: targetUserId === userId ? profileRow() : null }
        },
        getVerifiedAuthUser: async () => {
          calls.auth += 1

          return authenticated ? { id: userId } : null
        },
      }
    },
    getConfigStatus: () => {
      calls.config += 1

      return { configured }
    },
    parseRequest: parseCancelReservationRequest,
    respond: (body, init) => Response.json(body, init),
    runWorkflow: runCancelReservationWorkflow,
  })

  return { adapter, calls }
}

test("malformed JSON is rejected before cancellation config access", async () => {
  // Given: malformed JSON and an unavailable Supabase configuration.
  const { adapter, calls } = createHarness({ configured: false })

  // When: the route adapter handles the request.
  const response = await adapter(cancellationRequest("{"), reservationId)

  // Then: parsing owns the boundary and no configuration or session is touched.
  assert.equal(response.status, 422)
  assert.deepEqual(await response.json(), {
    error: {
      code: "VALIDATION_ERROR",
      details: [],
      message: "Request body must be valid JSON.",
    },
  })
  assert.equal(calls.config, 0)
  assert.equal(calls.session, 0)
})

for (const [name, origin] of [
  ["missing", null],
  ["cross-origin", "https://attacker.example"],
]) {
  test(`cancellation rejects ${name} Origin`, async () => {
    const { adapter, calls } = createHarness({ configured: false })
    const headers = new Headers({ "content-type": "application/json" })
    if (origin) headers.set("origin", origin)

    const response = await adapter(
      cancellationRequest(JSON.stringify({ reason: "x" }), headers),
      reservationId,
    )

    assert.equal(response.status, 403)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), {
      error: { code: "FORBIDDEN", details: [], message: "Same-origin request required." },
    })
    assert.equal(calls.config, 0)
    assert.equal(calls.session, 0)
  })
}

for (const [name, contentType] of [
  ["missing", null],
  ["non-JSON", "text/plain"],
]) {
  test(`cancellation rejects ${name} Content-Type`, async () => {
    const { adapter, calls } = createHarness({ configured: false })
    const headers = new Headers({ origin: "http://localhost" })
    if (contentType) headers.set("content-type", contentType)

    const response = await adapter(
      cancellationRequest(JSON.stringify({ reason: "x" }), headers),
      reservationId,
    )

    assert.equal(response.status, 415)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.deepEqual(await response.json(), {
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        details: [],
        message: "Content-Type must be application/json.",
      },
    })
    assert.equal(calls.config, 0)
    assert.equal(calls.session, 0)
  })
}

test("invalid cancellation data is parsed before cancellation config access", async () => {
  // Given: a structurally invalid request and unavailable Supabase configuration.
  const { adapter, calls } = createHarness({ configured: false })
  const request = cancellationRequest(JSON.stringify({ reason: "" }))

  // When: the route adapter handles the request.
  const response = await adapter(request, reservationId)

  // Then: schema parsing returns its validation details without reading configuration.
  assert.equal(response.status, 422)
  const responseBody = await response.json()
  assert.equal(responseBody.error.code, "VALIDATION_ERROR")
  assert.equal(responseBody.error.message, "Reservation cancellation request is invalid.")
  assert.equal(responseBody.error.details.length, 1)
  assert.equal(calls.config, 0)
  assert.equal(calls.session, 0)
})

test("valid cancellation returns 503 when Supabase config is absent", async () => {
  // Given: a valid cancellation request and unavailable Supabase configuration.
  const { adapter, calls } = createHarness({ configured: false })

  // When: the route adapter handles the request.
  const response = await adapter(cancellationRequest(), reservationId)

  // Then: the route is bounded before creating a session.
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    error: {
      code: "SUPABASE_NOT_CONFIGURED",
      details: [],
      message: "Supabase is not configured.",
    },
  })
  assert.equal(calls.config, 1)
  assert.equal(calls.session, 0)
})

test("authenticated cancellation forwards RPC args, response envelope, and cookies", async () => {
  // Given: an authenticated session whose RPC returns a cancellation with a refund.
  const { adapter, calls } = createHarness()

  // When: the route adapter handles a valid cancellation.
  const response = await adapter(cancellationRequest(), reservationId)

  // Then: the session RPC contract and HTTP response are preserved.
  assert.equal(response.status, 200)
  assert.deepEqual(calls.rpc, [
    {
      checked_reason: "Schedule changed",
      checked_reservation_id: reservationId,
    },
  ])
  assert.deepEqual(await response.json(), {
    data: {
      cancelledAt: cancellation.cancelled_at,
      refund: {
        amount: cancellation.refund_amount,
        id: cancellation.refund_id,
        status: cancellation.refund_status,
      },
      reservationId,
      status: cancellation.reservation_status,
    },
  })
  assert.equal(response.headers.get("set-cookie"), "spolink-session=refreshed; Path=/; HttpOnly")
})

test("unauthenticated cancellation returns 401 without invoking the RPC", async () => {
  // Given: a configured route with no authenticated user.
  const { adapter, calls } = createHarness({ authenticated: false })

  // When: the route adapter handles a valid cancellation.
  const response = await adapter(cancellationRequest(), reservationId)

  // Then: authentication fails closed before the cancellation RPC.
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: { code: "UNAUTHORIZED", details: [], message: "Authentication required." },
  })
  assert.equal(calls.auth, 1)
  assert.equal(calls.profile, 0)
  assert.deepEqual(calls.rpc, [])
})

test("cancellation RPC errors retain mapped status, envelope, and cookies", async () => {
  // Given: an authenticated session whose cancellation RPC cannot find the reservation.
  const { adapter, calls } = createHarness({
    rpcResult: { cancellation: null, errorCode: "P0002" },
  })

  // When: the route adapter handles a valid cancellation.
  const response = await adapter(cancellationRequest(), reservationId)

  // Then: the workflow mapping reaches the HTTP boundary without losing session headers.
  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { code: "NOT_FOUND", details: [], message: "Reservation not found." },
  })
  assert.equal(calls.rpc.length, 1)
  assert.equal(response.headers.get("set-cookie"), "spolink-session=refreshed; Path=/; HttpOnly")
})

function profileRow() {
  return {
    avatar_path: null,
    default_region: "서울 강남구",
    deleted_at: null,
    display_name: "홍길동",
    id: userId,
    location_agreed_at: null,
    marketing_agreed_at: null,
    phone: "010-1234-5678",
    real_name: "홍길동",
    role: "learner",
    status: "active",
  }
}
