import { NextResponse } from "next/server"

import {
  parseConfirmPaymentRequest,
  runConfirmPaymentWorkflow,
} from "@/lib/payments/confirm-payment-api"
import { isAuthorizedEdgeRequestHeader } from "@/lib/payments/edge-auth"
import { createTossPaymentVerifier } from "@/lib/payments/toss-payment-verifier"
import {
  getEdgeRuntimeConfigStatus,
  getSupabaseServiceConfigStatus,
  getTossPaymentsConfigStatus,
  readEdgeRuntimeEnv,
  readTossPaymentsEnv,
} from "@/lib/supabase/env"
import { createSupabaseServiceClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  const requestJson = await readRequestJson(request)

  if (requestJson.status === "failure") {
    return apiError("VALIDATION_ERROR", "Request body must be valid JSON.", 422)
  }

  const parsedRequest = parseConfirmPaymentRequest(requestJson.value)

  if (parsedRequest.status === "failure") {
    return apiError(
      "VALIDATION_ERROR",
      "Invalid payment confirm request.",
      422,
      parsedRequest.issues,
    )
  }

  if (!getEdgeRuntimeConfigStatus().configured) {
    return apiError("EDGE_SECRET_NOT_CONFIGURED", "Edge secret is not configured.", 503)
  }

  if (!isAuthorizedEdgeRequest(request)) {
    return apiError("FORBIDDEN", "Trusted edge request required.", 403)
  }

  if (!getSupabaseServiceConfigStatus().configured) {
    return apiError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
  }

  if (!getTossPaymentsConfigStatus().configured) {
    return apiError("EXTERNAL_PROVIDER_ERROR", "Payment provider is not configured.", 502)
  }

  const supabase = createSupabaseServiceClient()
  const tossEnv = readTossPaymentsEnv()
  const workflowResult = await runConfirmPaymentWorkflow(parsedRequest.request, {
    confirmPaidReservation: async (paymentRequest, rawPayload) => {
      const { data: payments, error } = await supabase.rpc("confirm_paid_reservation", {
        checked_amount: paymentRequest.amount,
        checked_provider_order_id: paymentRequest.providerOrderId,
        checked_provider_payment_key: paymentRequest.providerPaymentKey,
        checked_raw_payload: rawPayload,
        checked_reservation_id: paymentRequest.reservationId,
      })

      return {
        errorCode: error?.code ?? null,
        payment: payments?.[0] ?? null,
      }
    },
    markPaymentConfirmationFailed: async (paymentRequest, failure) => {
      const { error } = await supabase.rpc("mark_payment_confirmation_failed", {
        checked_failed_reason: failure.reason,
        checked_provider_order_id: paymentRequest.providerOrderId,
        checked_raw_payload: failure.rawPayload,
        checked_reservation_id: paymentRequest.reservationId,
      })

      return { errorCode: error?.code ?? null }
    },
    markPaymentConfirmationReconciliationRequired: async (paymentRequest, failure) => {
      const { error } = await supabase.rpc("mark_payment_confirmation_reconciliation_required", {
        checked_failure_code: failure.failureCode,
        checked_provider_order_id: paymentRequest.providerOrderId,
        checked_provider_payment_key: paymentRequest.providerPaymentKey,
        checked_raw_payload: failure.rawPayload,
        checked_reservation_id: paymentRequest.reservationId,
      })

      return { errorCode: error?.code ?? null }
    },
    verifyProviderPayment: createTossPaymentVerifier(tossEnv.secretKey),
  })

  if (workflowResult.status === "failure") {
    return apiError(
      workflowResult.error.code,
      workflowResult.error.message,
      workflowResult.error.statusCode,
    )
  }

  return NextResponse.json(workflowResult.response, {
    status: workflowResult.statusCode,
  })
}

function apiError(code: string, message: string, status: number, details?: readonly string[]) {
  return NextResponse.json({ error: { code, details: details ?? [], message } }, { status })
}

function isAuthorizedEdgeRequest(request: Request) {
  return isAuthorizedEdgeRequestHeader(
    request.headers.get("authorization"),
    readEdgeRuntimeEnv().edgeSecret,
  )
}

async function readRequestJson(request: Request): Promise<
  Readonly<
    | {
        status: "success"
        value: unknown
      }
    | {
        status: "failure"
      }
  >
> {
  try {
    const value: unknown = await request.json()

    return { status: "success", value }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { status: "failure" }
    }

    throw error
  }
}
