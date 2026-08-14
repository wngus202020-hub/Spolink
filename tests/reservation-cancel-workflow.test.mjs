import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCancelReservationResponse,
  parseCancelReservationRequest,
  runCancelReservationWorkflow,
} from "../lib/reservations/cancel-reservation-api.ts"

const reservationId = "00000000-0000-4000-8000-000000000401"
const request = Object.freeze({ reason: "일정 변경", reservationId })
const cancelledAt = "2026-08-01T09:00:00+09:00"
const userId = "00000000-0000-4000-8000-000000000001"

const cancelledWithoutRefund = Object.freeze({
  cancelled_at: cancelledAt,
  refund_amount: null,
  refund_id: null,
  refund_status: null,
  reservation_id: reservationId,
  reservation_status: "cancelled_by_user",
})

const cancelledWithRefund = Object.freeze({
  cancelled_at: cancelledAt,
  refund_amount: 7000,
  refund_id: "00000000-0000-4000-8000-000000000601",
  refund_status: "requested",
  reservation_id: reservationId,
  reservation_status: "cancelled_by_user",
})

function authenticatedDependencies(result) {
  return {
    cancelReservation: async () => result,
    getCurrentProfile: async (targetUserId) => ({
      errorCode: null,
      profile: targetUserId === userId ? profileRow() : null,
    }),
    getVerifiedAuthUser: async () => ({ id: userId }),
  }
}

test("cancel request parser trims a valid path UUID and reason", () => {
  const result = parseCancelReservationRequest(` ${reservationId} `, { reason: "  일정 변경  " })

  assert.deepEqual(result, {
    request: { reason: "일정 변경", reservationId },
    status: "success",
  })
})

test("cancel request parser rejects malformed path and JSON shapes", () => {
  const invalidInputs = [
    ["not-a-uuid", { reason: "일정 변경" }],
    [reservationId, null],
    [reservationId, []],
    [reservationId, { reason: "일정 변경", actor: "admin" }],
  ]

  for (const [path, body] of invalidInputs) {
    assert.equal(parseCancelReservationRequest(path, body).status, "failure")
  }
})

test("cancel request parser rejects blank, missing, non-string, and overlong reasons", () => {
  const invalidBodies = [{}, { reason: "   " }, { reason: 7 }, { reason: "가".repeat(201) }]

  for (const body of invalidBodies) {
    assert.equal(parseCancelReservationRequest(reservationId, body).status, "failure")
  }
})

test("cancel workflow returns the exact response when no refund is created", async () => {
  const result = await runCancelReservationWorkflow(
    request,
    authenticatedDependencies({ cancellation: cancelledWithoutRefund, errorCode: null }),
  )

  assert.deepEqual(result, {
    response: {
      data: {
        cancelledAt,
        refund: null,
        reservationId,
        status: "cancelled_by_user",
      },
    },
    status: "success",
    statusCode: 200,
  })
})

test("cancel response includes the exact nested refund shape", () => {
  assert.deepEqual(buildCancelReservationResponse(cancelledWithRefund), {
    data: {
      cancelledAt,
      refund: {
        amount: 7000,
        id: cancelledWithRefund.refund_id,
        status: "requested",
      },
      reservationId,
      status: "cancelled_by_user",
    },
  })
})

test("cancel workflow passes only checked reservation id and checked reason to the RPC", async () => {
  const calls = []

  await runCancelReservationWorkflow(request, {
    cancelReservation: async (args) => {
      calls.push(args)
      return { cancellation: cancelledWithRefund, errorCode: null }
    },
    getCurrentProfile: async () => ({ errorCode: null, profile: profileRow() }),
    getVerifiedAuthUser: async () => ({ id: userId }),
  })

  assert.deepEqual(calls, [{ checked_reason: "일정 변경", checked_reservation_id: reservationId }])
})

test("cancel workflow blocks unauthenticated users before RPC", async () => {
  let profileCalled = false
  let rpcCallCount = 0
  const result = await runCancelReservationWorkflow(request, {
    cancelReservation: async () => {
      rpcCallCount += 1
      return { cancellation: cancelledWithoutRefund, errorCode: null }
    },
    getCurrentProfile: async () => {
      profileCalled = true
      return { errorCode: null, profile: profileRow() }
    },
    getVerifiedAuthUser: async () => null,
  })

  assert.equal(profileCalled, false)
  assert.equal(rpcCallCount, 0)
  assert.deepEqual(result, {
    error: { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
    status: "failure",
  })
})

test("cancel workflow blocks missing and restricted profiles before RPC", async () => {
  for (const [profile, expected] of [
    [null, ["PROFILE_REQUIRED", "Profile setup required.", 409]],
    [profileRow({ status: "suspended" }), ["ACCOUNT_SUSPENDED", "Account is suspended.", 403]],
    [profileRow({ status: "deleted" }), ["ACCOUNT_DELETED", "Account is unavailable.", 403]],
    [
      profileRow({ deleted_at: "2026-07-19T00:00:00.000Z" }),
      ["ACCOUNT_DELETED", "Account is unavailable.", 403],
    ],
  ]) {
    let rpcCallCount = 0
    const result = await runCancelReservationWorkflow(request, {
      cancelReservation: async () => {
        rpcCallCount += 1
        return { cancellation: cancelledWithoutRefund, errorCode: null }
      },
      getCurrentProfile: async () => ({ errorCode: null, profile }),
      getVerifiedAuthUser: async () => ({ id: userId }),
    })
    const [code, message, statusCode] = expected

    assert.equal(rpcCallCount, 0)
    assert.deepEqual(result, { error: { code, message, statusCode }, status: "failure" })
  }
})

test("cancel workflow preserves allowed profile statuses before RPC", async () => {
  for (const status of ["active", "pending_coach", "coach_approved"]) {
    let rpcCallCount = 0
    const result = await runCancelReservationWorkflow(request, {
      cancelReservation: async () => {
        rpcCallCount += 1
        return { cancellation: cancelledWithoutRefund, errorCode: null }
      },
      getCurrentProfile: async () => ({ errorCode: null, profile: profileRow({ status }) }),
      getVerifiedAuthUser: async () => ({ id: userId }),
    })

    assert.equal(rpcCallCount, 1)
    assert.equal(result.status, "success")
  }
})

test("cancel workflow maps every documented SQL error code", async () => {
  const cases = [
    ["22023", "VALIDATION_ERROR", 422],
    ["42501", "FORBIDDEN", 403],
    ["P0002", "NOT_FOUND", 404],
    ["P0001", "INVALID_STATE_TRANSITION", 409],
    ["23505", "CONFLICT", 409],
  ]

  for (const [sqlCode, apiCode, statusCode] of cases) {
    const result = await runCancelReservationWorkflow(
      request,
      authenticatedDependencies({ cancellation: null, errorCode: sqlCode }),
    )

    assert.equal(result.status, "failure")
    assert.equal(result.error.code, apiCode)
    assert.equal(result.error.statusCode, statusCode)
  }
})

function profileRow(overrides = {}) {
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
    ...overrides,
  }
}

test("cancel workflow fails closed for malformed RPC rows", async () => {
  const malformedRows = [
    { ...cancelledWithRefund, cancelled_at: "not-a-timestamp" },
    { ...cancelledWithRefund, refund_amount: -1 },
    { ...cancelledWithRefund, refund_id: null },
    { ...cancelledWithRefund, refund_status: "unexpected" },
    { ...cancelledWithRefund, reservation_status: "confirmed" },
  ]

  for (const cancellation of malformedRows) {
    const result = await runCancelReservationWorkflow(
      request,
      authenticatedDependencies({ cancellation, errorCode: null }),
    )

    assert.equal(result.status, "failure")
    assert.equal(result.error.code, "CONFLICT")
  }
})

test("cancel workflow fails closed for unknown and null failures", async () => {
  for (const errorCode of ["XX999", null]) {
    const result = await runCancelReservationWorkflow(
      request,
      authenticatedDependencies({ cancellation: null, errorCode }),
    )

    assert.deepEqual(result, {
      error: {
        code: "CONFLICT",
        message: "Reservation cannot be cancelled.",
        statusCode: 409,
      },
      status: "failure",
    })
  }
})
