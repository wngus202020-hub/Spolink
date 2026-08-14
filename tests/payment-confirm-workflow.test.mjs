import assert from "node:assert/strict"
import test from "node:test"

import { runConfirmPaymentWorkflow } from "../lib/payments/confirm-payment-api.ts"

const request = Object.freeze({
  amount: 50000,
  providerOrderId: "spolink_00000000-0000-4000-8000-000000000401",
  providerPaymentKey: "payment-key",
  reservationId: "00000000-0000-4000-8000-000000000401",
})

const confirmedPayment = Object.freeze({
  payment_id: "00000000-0000-4000-8000-000000000501",
  reservation_id: request.reservationId,
})

test("payment confirm workflow returns paid response after provider and RPC success", async () => {
  const result = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({
      errorCode: null,
      payment: confirmedPayment,
    }),
    markPaymentConfirmationFailed: async () => ({ errorCode: null }),
    markPaymentConfirmationReconciliationRequired: async () => ({ errorCode: null }),
    verifyProviderPayment: async () => ({
      rawPayload: { status: "DONE" },
      status: "success",
    }),
  })

  assert.deepEqual(result, {
    response: {
      data: {
        paymentId: confirmedPayment.payment_id,
        reservationId: request.reservationId,
        status: "paid",
      },
    },
    status: "success",
    statusCode: 200,
  })
})

test("payment confirm workflow stops before RPC when provider verification fails", async () => {
  let rpcCalled = false
  let failureRecord = null
  const result = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => {
      rpcCalled = true

      return {
        errorCode: null,
        payment: confirmedPayment,
      }
    },
    markPaymentConfirmationFailed: async (_, failure) => {
      failureRecord = failure

      return { errorCode: null }
    },
    markPaymentConfirmationReconciliationRequired: async () => ({ errorCode: null }),
    verifyProviderPayment: async () => ({
      status: "failure",
      type: "verification_failed",
    }),
  })

  assert.equal(rpcCalled, false)
  assert.deepEqual(failureRecord, {
    rawPayload: {
      provider: "toss",
      type: "verification_failed",
    },
    reason: "verification_failed",
  })
  assert.deepEqual(result, {
    error: {
      code: "PAYMENT_VERIFICATION_FAILED",
      message: "Payment verification failed.",
      statusCode: 400,
    },
    status: "failure",
  })
})

test("payment confirm workflow does not mark failed payment for provider transport errors", async () => {
  let failureRecorded = false
  const result = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({
      errorCode: null,
      payment: confirmedPayment,
    }),
    markPaymentConfirmationFailed: async () => {
      failureRecorded = true

      return { errorCode: null }
    },
    markPaymentConfirmationReconciliationRequired: async () => ({ errorCode: null }),
    verifyProviderPayment: async () => ({
      status: "failure",
      type: "provider_error",
    }),
  })

  assert.equal(failureRecorded, false)
  assert.deepEqual(result, {
    error: {
      code: "EXTERNAL_PROVIDER_ERROR",
      message: "Payment provider request failed.",
      statusCode: 502,
    },
    status: "failure",
  })
})

test("payment confirm workflow maps RPC conflict codes", async () => {
  const reconciliationRecords = []
  const expiredResult = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({ errorCode: "P0005", payment: null }),
    markPaymentConfirmationFailed: async () => ({ errorCode: null }),
    markPaymentConfirmationReconciliationRequired: async (_, failure) => {
      reconciliationRecords.push(failure)

      return { errorCode: null }
    },
    verifyProviderPayment: async () => ({ rawPayload: { status: "DONE" }, status: "success" }),
  })
  const capacityResult = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({ errorCode: "P0003", payment: null }),
    markPaymentConfirmationFailed: async () => ({ errorCode: null }),
    markPaymentConfirmationReconciliationRequired: async (_, failure) => {
      reconciliationRecords.push(failure)

      return { errorCode: null }
    },
    verifyProviderPayment: async () => ({ rawPayload: { status: "DONE" }, status: "success" }),
  })
  const mismatchResult = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({ errorCode: "P0007", payment: null }),
    markPaymentConfirmationFailed: async () => ({ errorCode: null }),
    markPaymentConfirmationReconciliationRequired: async (_, failure) => {
      reconciliationRecords.push(failure)

      return { errorCode: null }
    },
    verifyProviderPayment: async () => ({ rawPayload: { status: "DONE" }, status: "success" }),
  })

  assert.deepEqual(reconciliationRecords, [
    { failureCode: "P0005", rawPayload: { status: "DONE" } },
    { failureCode: "P0003", rawPayload: { status: "DONE" } },
    { failureCode: "P0007", rawPayload: { status: "DONE" } },
  ])
  assert.equal(
    expiredResult.status === "failure" && expiredResult.error.code,
    "RESERVATION_EXPIRED",
  )
  assert.equal(
    capacityResult.status === "failure" && capacityResult.error.code,
    "CAPACITY_EXCEEDED",
  )
  assert.equal(
    mismatchResult.status === "failure" && mismatchResult.error.code,
    "PAYMENT_VERIFICATION_FAILED",
  )
})

test("payment confirm workflow fails closed when required side-effect records fail", async () => {
  const failedRecordResult = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({
      errorCode: null,
      payment: confirmedPayment,
    }),
    markPaymentConfirmationFailed: async () => ({ errorCode: "42501" }),
    markPaymentConfirmationReconciliationRequired: async () => ({ errorCode: null }),
    verifyProviderPayment: async () => ({
      status: "failure",
      type: "verification_failed",
    }),
  })
  const reconciliationRecordResult = await runConfirmPaymentWorkflow(request, {
    confirmPaidReservation: async () => ({ errorCode: "P0003", payment: null }),
    markPaymentConfirmationFailed: async () => ({ errorCode: null }),
    markPaymentConfirmationReconciliationRequired: async () => ({ errorCode: "42501" }),
    verifyProviderPayment: async () => ({ rawPayload: { status: "DONE" }, status: "success" }),
  })

  assert.equal(failedRecordResult.status === "failure" && failedRecordResult.error.code, "CONFLICT")
  assert.equal(
    reconciliationRecordResult.status === "failure" && reconciliationRecordResult.error.code,
    "CONFLICT",
  )
})
