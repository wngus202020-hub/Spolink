import { z } from "zod"

import type { Database, Json } from "@/lib/supabase/database.types"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const confirmPaymentRequestSchema = z.object({
  amount: z.number().int().nonnegative(),
  providerOrderId: z.string().trim().min(6).max(64),
  providerPaymentKey: z.string().trim().min(1).max(200),
  reservationId: z.string().trim().regex(uuidPattern, "reservationId must be a UUID"),
})

export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>

export type ConfirmPaymentRequestParseResult = Readonly<
  | {
      request: ConfirmPaymentRequest
      status: "success"
    }
  | {
      issues: readonly string[]
      status: "failure"
    }
>

export type ConfirmPaymentResponse = Readonly<{
  data: Readonly<{
    paymentId: string
    reservationId: string
    status: "paid"
  }>
}>

export type ConfirmPaymentWorkflowResult = Readonly<
  | {
      response: ConfirmPaymentResponse
      status: "success"
      statusCode: 200
    }
  | {
      error: ConfirmPaymentWorkflowError
      status: "failure"
    }
>

export type ConfirmPaymentWorkflowError = Readonly<{
  code:
    | "CAPACITY_EXCEEDED"
    | "CONFLICT"
    | "EXTERNAL_PROVIDER_ERROR"
    | "NOT_FOUND"
    | "PAYMENT_VERIFICATION_FAILED"
    | "RESERVATION_EXPIRED"
  message: string
  statusCode: 400 | 404 | 409 | 502
}>

export type ConfirmPaymentSideEffectResult = Readonly<{
  errorCode: string | null
}>

export type ConfirmPaymentWorkflowDependencies = Readonly<{
  confirmPaidReservation: (
    request: ConfirmPaymentRequest,
    rawPayload: Json,
  ) => Promise<ConfirmPaymentRpcResult>
  markPaymentConfirmationFailed: (
    request: ConfirmPaymentRequest,
    failure: PaymentConfirmationFailureRecord,
  ) => Promise<ConfirmPaymentSideEffectResult>
  markPaymentConfirmationReconciliationRequired: (
    request: ConfirmPaymentRequest,
    failure: PaymentConfirmationReconciliationRecord,
  ) => Promise<ConfirmPaymentSideEffectResult>
  verifyProviderPayment: (
    request: ConfirmPaymentRequest,
  ) => Promise<ProviderPaymentVerificationResult>
}>

export type PaymentConfirmationFailureRecord = Readonly<{
  rawPayload: Json
  reason: string
}>

export type PaymentConfirmationReconciliationRecord = Readonly<{
  failureCode: string
  rawPayload: Json
}>

export type ProviderPaymentVerificationResult = Readonly<
  | {
      rawPayload: Json
      status: "success"
    }
  | {
      status: "failure"
      type: "provider_error" | "verification_failed"
    }
>

export type ConfirmPaymentRpcResult = Readonly<{
  errorCode: string | null
  payment: ConfirmedPaymentRow | null
}>

type ConfirmedPaymentRow =
  Database["public"]["Functions"]["confirm_paid_reservation"]["Returns"][number]

export function parseConfirmPaymentRequest(value: unknown): ConfirmPaymentRequestParseResult {
  const parsedRequest = confirmPaymentRequestSchema.safeParse(value)

  return parsedRequest.success
    ? { request: parsedRequest.data, status: "success" }
    : { issues: parsedRequest.error.issues.map((issue) => issue.message), status: "failure" }
}

export async function runConfirmPaymentWorkflow(
  request: ConfirmPaymentRequest,
  dependencies: ConfirmPaymentWorkflowDependencies,
): Promise<ConfirmPaymentWorkflowResult> {
  const providerResult = await dependencies.verifyProviderPayment(request)

  if (providerResult.status === "failure") {
    if (providerResult.type === "verification_failed") {
      const failureRecordResult = await dependencies.markPaymentConfirmationFailed(
        request,
        buildPaymentConfirmationFailureRecord(providerResult.type),
      )

      if (failureRecordResult.errorCode) {
        return { error: mapConfirmPaymentFailure(failureRecordResult.errorCode), status: "failure" }
      }
    }

    return {
      error: mapProviderVerificationFailure(providerResult.type),
      status: "failure",
    }
  }

  const result = await dependencies.confirmPaidReservation(request, providerResult.rawPayload)

  if (!result.payment) {
    const reconciliationResult = await dependencies.markPaymentConfirmationReconciliationRequired(
      request,
      {
        failureCode: result.errorCode ?? "unknown",
        rawPayload: providerResult.rawPayload,
      },
    )

    if (reconciliationResult.errorCode) {
      return { error: mapConfirmPaymentFailure(reconciliationResult.errorCode), status: "failure" }
    }

    return { error: mapConfirmPaymentFailure(result.errorCode), status: "failure" }
  }

  return {
    response: buildConfirmPaymentResponse(result.payment),
    status: "success",
    statusCode: 200,
  }
}

export function buildConfirmPaymentResponse(row: ConfirmedPaymentRow): ConfirmPaymentResponse {
  return {
    data: {
      paymentId: row.payment_id,
      reservationId: row.reservation_id,
      status: "paid",
    },
  }
}

function buildPaymentConfirmationFailureRecord(
  type: "provider_error" | "verification_failed",
): PaymentConfirmationFailureRecord {
  return {
    rawPayload: {
      provider: "toss",
      type,
    },
    reason: type,
  }
}

function mapProviderVerificationFailure(
  type: "provider_error" | "verification_failed",
): ConfirmPaymentWorkflowError {
  if (type === "verification_failed") {
    return {
      code: "PAYMENT_VERIFICATION_FAILED",
      message: "Payment verification failed.",
      statusCode: 400,
    }
  }

  return {
    code: "EXTERNAL_PROVIDER_ERROR",
    message: "Payment provider request failed.",
    statusCode: 502,
  }
}

export function mapConfirmPaymentFailure(errorCode: string | null): ConfirmPaymentWorkflowError {
  if (errorCode === "P0002") {
    return { code: "NOT_FOUND", message: "Payment not found.", statusCode: 404 }
  }

  if (errorCode === "P0003") {
    return { code: "CAPACITY_EXCEEDED", message: "Schedule capacity exceeded.", statusCode: 409 }
  }

  if (errorCode === "P0005") {
    return { code: "RESERVATION_EXPIRED", message: "Reservation expired.", statusCode: 409 }
  }

  if (errorCode === "P0007") {
    return {
      code: "PAYMENT_VERIFICATION_FAILED",
      message: "Payment amount or order id does not match.",
      statusCode: 400,
    }
  }

  return { code: "CONFLICT", message: "Payment cannot be confirmed.", statusCode: 409 }
}
