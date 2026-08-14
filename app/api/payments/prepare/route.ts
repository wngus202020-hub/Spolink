import { NextResponse } from "next/server"

import { readRequestJson } from "@/lib/api/json"
import { hasJsonContentType, hasSameOrigin } from "@/lib/auth/route-security"
import {
  parsePreparePaymentRequest,
  runPreparePaymentWorkflow,
} from "@/lib/payments/prepare-payment-api"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return apiError("FORBIDDEN", "Same-origin request required.", 403)
  }

  if (!hasJsonContentType(request)) {
    return apiError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
  }

  const requestJson = await readRequestJson(request)

  if (requestJson.status === "failure") {
    return apiError("VALIDATION_ERROR", "Request body must be valid JSON.", 422)
  }

  const parsedRequest = parsePreparePaymentRequest(requestJson.value)

  if (parsedRequest.status === "failure") {
    return apiError(
      "VALIDATION_ERROR",
      "Invalid payment prepare request.",
      422,
      parsedRequest.issues,
    )
  }

  if (!getSupabaseConfigStatus().configured) {
    return apiError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
  }

  const responseHeaders = new Headers()
  const supabase = await createSupabaseServerClient(responseHeaders)
  const workflowResult = await runPreparePaymentWorkflow(parsedRequest.request, {
    createReadyPayment: async (paymentRequest) => {
      const { data: payments, error } = await supabase.rpc("create_ready_payment", {
        checked_reservation_id: paymentRequest.reservationId,
      })
      const payment = payments?.length === 1 ? (payments[0] ?? null) : null

      return {
        errorCode: error?.code ?? null,
        payment,
      }
    },
    getCurrentProfile: async (userId) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle()

      return { errorCode: error?.code ?? null, profile }
    },
    getVerifiedAuthUser: async () => {
      const { data, error } = await supabase.auth.getClaims()
      const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null

      return error || !userId ? null : { id: userId }
    },
  })

  if (workflowResult.status === "failure") {
    return apiError(
      workflowResult.error.code,
      workflowResult.error.message,
      workflowResult.error.statusCode,
      undefined,
      responseHeaders,
    )
  }

  return NextResponse.json(workflowResult.response, {
    headers: withNoStore(responseHeaders),
    status: workflowResult.statusCode,
  })
}

function apiError(
  code: string,
  message: string,
  status: number,
  details?: readonly string[],
  headers?: Headers,
) {
  if (headers) {
    return NextResponse.json(
      { error: { code, details: details ?? [], message } },
      { headers: withNoStore(headers), status },
    )
  }

  return NextResponse.json(
    { error: { code, details: details ?? [], message } },
    { headers: withNoStore(), status },
  )
}

function withNoStore(headers?: Headers): Headers {
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Cache-Control", "private, no-store")

  return responseHeaders
}
