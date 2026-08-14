import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPreparePaymentResponse,
  runPreparePaymentWorkflow,
} from "../lib/payments/prepare-payment-api.ts"

const request = Object.freeze({
  reservationId: "00000000-0000-4000-8000-000000000401",
})
const userId = "00000000-0000-4000-8000-000000000001"

const readyPayment = Object.freeze({
  amount: 50000,
  order_name: "입문 테니스 레슨",
  payment_id: "00000000-0000-4000-8000-000000000501",
  provider: "toss",
  provider_order_id: "spolink_00000000-0000-4000-8000-000000000401",
})

test("payment prepare workflow returns ready payment response for authenticated RPC success", async () => {
  const result = await runPreparePaymentWorkflow(
    request,
    authenticatedDependencies({
      createReadyPayment: async () => ({
        errorCode: null,
        payment: readyPayment,
      }),
    }),
  )

  assert.deepEqual(result, {
    response: {
      data: {
        amount: readyPayment.amount,
        orderName: readyPayment.order_name,
        paymentId: readyPayment.payment_id,
        provider: "toss",
        providerOrderId: readyPayment.provider_order_id,
      },
    },
    status: "success",
    statusCode: 201,
  })
})

test("payment prepare workflow blocks unauthenticated users before RPC", async () => {
  let profileCalled = false
  let rpcCalled = false
  const result = await runPreparePaymentWorkflow(request, {
    createReadyPayment: async () => {
      rpcCalled = true

      return {
        errorCode: null,
        payment: readyPayment,
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

test("payment prepare workflow blocks missing and restricted profiles before RPC", async () => {
  for (const [profile, expected] of [
    [null, ["PROFILE_REQUIRED", "Profile setup required.", 409]],
    [profileRow({ status: "suspended" }), ["ACCOUNT_SUSPENDED", "Account is suspended.", 403]],
    [profileRow({ status: "deleted" }), ["ACCOUNT_DELETED", "Account is unavailable.", 403]],
    [
      profileRow({ deleted_at: "2026-07-19T00:00:00.000Z" }),
      ["ACCOUNT_DELETED", "Account is unavailable.", 403],
    ],
  ]) {
    let rpcCalled = false
    const result = await runPreparePaymentWorkflow(
      request,
      authenticatedDependencies({
        createReadyPayment: async () => {
          rpcCalled = true
          return { errorCode: null, payment: readyPayment }
        },
        profile,
      }),
    )
    const [code, message, statusCode] = expected

    assert.equal(rpcCalled, false)
    assert.deepEqual(result, { error: { code, message, statusCode }, status: "failure" })
  }
})

test("payment prepare workflow preserves allowed profile statuses before RPC", async () => {
  for (const status of ["active", "pending_coach", "coach_approved"]) {
    let rpcCalled = false
    const result = await runPreparePaymentWorkflow(
      request,
      authenticatedDependencies({
        createReadyPayment: async () => {
          rpcCalled = true
          return { errorCode: null, payment: readyPayment }
        },
        profile: profileRow({ status }),
      }),
    )

    assert.equal(rpcCalled, true)
    assert.equal(result.status, "success")
  }
})

test("payment prepare workflow preserves reservation failure error codes", async () => {
  const expiredResult = await runPreparePaymentWorkflow(
    request,
    authenticatedDependencies({
      createReadyPayment: async () => ({
        errorCode: "P0005",
        payment: null,
      }),
    }),
  )
  const conflictResult = await runPreparePaymentWorkflow(
    request,
    authenticatedDependencies({
      createReadyPayment: async () => ({
        errorCode: "23505",
        payment: null,
      }),
    }),
  )
  const forbiddenResult = await runPreparePaymentWorkflow(
    request,
    authenticatedDependencies({
      createReadyPayment: async () => ({
        errorCode: "42501",
        payment: null,
      }),
    }),
  )
  const notFoundResult = await runPreparePaymentWorkflow(
    request,
    authenticatedDependencies({
      createReadyPayment: async () => ({
        errorCode: "P0002",
        payment: null,
      }),
    }),
  )

  assert.equal(
    expiredResult.status === "failure" && expiredResult.error.code,
    "RESERVATION_EXPIRED",
  )
  assert.equal(conflictResult.status === "failure" && conflictResult.error.code, "CONFLICT")
  assert.equal(forbiddenResult.status === "failure" && forbiddenResult.error.code, "FORBIDDEN")
  assert.equal(notFoundResult.status === "failure" && notFoundResult.error.code, "NOT_FOUND")
})

test("payment prepare response rejects unsupported providers from the payment RPC", () => {
  assert.throws(
    () =>
      buildPreparePaymentResponse({
        ...readyPayment,
        provider: "unexpected-provider",
      }),
    /Unsupported payment provider/,
  )
})

function authenticatedDependencies({ createReadyPayment, profile = profileRow() }) {
  return {
    createReadyPayment,
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
