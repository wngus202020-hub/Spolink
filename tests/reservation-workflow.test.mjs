import assert from "node:assert/strict"
import test from "node:test"

import { runCreateReservationWorkflow } from "../lib/reservations/create-reservation-api.ts"

const request = Object.freeze({
  lessonId: "00000000-0000-4000-8000-000000000101",
  lessonScheduleId: "00000000-0000-4000-8000-000000000301",
})
const userId = "00000000-0000-4000-8000-000000000001"

const pendingReservation = Object.freeze({
  id: "00000000-0000-4000-8000-000000000401",
  payment_expires_at: "2026-08-01T09:10:00+09:00",
  reserved_price_amount: 50000,
  status: "pending_payment",
})

test("reservation workflow returns pending payment response for authenticated RPC success", async () => {
  const result = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => ({
        errorCode: null,
        reservation: pendingReservation,
      }),
    }),
  )

  assert.equal(result.status, "success")
  assert.equal(result.statusCode, 201)
  assert.deepEqual(result.response, {
    data: {
      id: pendingReservation.id,
      paymentExpiresAt: pendingReservation.payment_expires_at,
      reservedPriceAmount: pendingReservation.reserved_price_amount,
      status: "pending_payment",
    },
  })
})

test("reservation workflow blocks missing profiles before RPC", async () => {
  let rpcCalled = false
  const result = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => {
        rpcCalled = true

        return {
          errorCode: null,
          reservation: pendingReservation,
        }
      },
      profile: null,
    }),
  )

  assert.equal(rpcCalled, false)
  assert.deepEqual(result, {
    error: { code: "PROFILE_REQUIRED", message: "Profile setup required.", statusCode: 409 },
    status: "failure",
  })
})

test("reservation workflow blocks restricted profiles before RPC", async () => {
  for (const [profile, expected] of [
    [profileRow({ status: "suspended" }), ["ACCOUNT_SUSPENDED", "Account is suspended."]],
    [profileRow({ status: "deleted" }), ["ACCOUNT_DELETED", "Account is unavailable."]],
    [
      profileRow({ deleted_at: "2026-07-19T00:00:00.000Z" }),
      ["ACCOUNT_DELETED", "Account is unavailable."],
    ],
  ]) {
    let rpcCalled = false
    const result = await runCreateReservationWorkflow(
      request,
      authenticatedDependencies({
        createPendingReservation: async () => {
          rpcCalled = true

          return {
            errorCode: null,
            reservation: pendingReservation,
          }
        },
        profile,
      }),
    )
    const [code, message] = expected

    assert.equal(rpcCalled, false)
    assert.deepEqual(result, { error: { code, message, statusCode: 403 }, status: "failure" })
  }
})

test("reservation workflow preserves allowed profile statuses before RPC", async () => {
  for (const status of ["active", "pending_coach", "coach_approved"]) {
    let rpcCalled = false
    const result = await runCreateReservationWorkflow(
      request,
      authenticatedDependencies({
        createPendingReservation: async () => {
          rpcCalled = true

          return {
            errorCode: null,
            reservation: pendingReservation,
          }
        },
        profile: profileRow({ status }),
      }),
    )

    assert.equal(rpcCalled, true)
    assert.equal(result.status, "success")
  }
})

test("reservation workflow blocks unauthenticated users before profile or RPC", async () => {
  let profileCalled = false
  let rpcCalled = false
  const result = await runCreateReservationWorkflow(request, {
    createPendingReservation: async () => {
      rpcCalled = true
      return {
        errorCode: null,
        reservation: pendingReservation,
      }
    },
    getCurrentProfile: async () => {
      profileCalled = true
      return { errorCode: null, profile: profileRow() }
    },
    getVerifiedAuthUser: async () => null,
  })

  assert.equal(profileCalled, false)
  assert.equal(rpcCalled, false)
  assert.deepEqual(result, {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required.",
      statusCode: 401,
    },
    status: "failure",
  })
})

test("reservation workflow preserves documented capacity and conflict errors", async () => {
  const capacityResult = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => ({
        errorCode: "P0003",
        reservation: null,
      }),
    }),
  )
  const conflictResult = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => ({
        errorCode: "23505",
        reservation: null,
      }),
    }),
  )

  assert.deepEqual(capacityResult, {
    error: {
      code: "CAPACITY_EXCEEDED",
      message: "Schedule capacity exceeded.",
      statusCode: 409,
    },
    status: "failure",
  })
  assert.deepEqual(conflictResult, {
    error: {
      code: "CONFLICT",
      message: "Reservation cannot be created.",
      statusCode: 409,
    },
    status: "failure",
  })
})

test("reservation workflow preserves forbidden and not found RPC errors", async () => {
  const forbiddenResult = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => ({
        errorCode: "42501",
        reservation: null,
      }),
    }),
  )
  const notFoundResult = await runCreateReservationWorkflow(
    request,
    authenticatedDependencies({
      createPendingReservation: async () => ({
        errorCode: "P0002",
        reservation: null,
      }),
    }),
  )

  assert.deepEqual(forbiddenResult, {
    error: {
      code: "FORBIDDEN",
      message: "Learner account required.",
      statusCode: 403,
    },
    status: "failure",
  })
  assert.deepEqual(notFoundResult, {
    error: {
      code: "NOT_FOUND",
      message: "Lesson not found.",
      statusCode: 404,
    },
    status: "failure",
  })
})

function authenticatedDependencies({ createPendingReservation, profile = profileRow() }) {
  return {
    createPendingReservation,
    getCurrentProfile: async (targetUserId) => ({
      errorCode: null,
      profile: targetUserId === userId ? profile : null,
    }),
    getVerifiedAuthUser: async () => ({ id: userId }),
  }
}

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
