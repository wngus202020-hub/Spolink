import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import { isAuthorizedEdgeRequestHeader } from "../payments/edge-auth"
import {
  getEdgeRuntimeConfigStatus,
  getSupabaseServiceConfigStatus,
  readEdgeRuntimeEnv,
} from "../supabase/env"
import { createSupabaseServerClient, createSupabaseServiceClient } from "../supabase/server"
import {
  refundClaimSchema,
  refundResultSchema,
  settlementGenerateSchema,
  settlementHoldSchema,
  uuidSchema,
} from "./contract"
import { listSettlements } from "./read-model"

export async function getSettlementList(request: Request) {
  const headers = new Headers()
  const client = await createSupabaseServerClient(headers)
  const user = await client.auth.getUser()
  if (user.error || !user.data.user)
    return apiErrorResponse(
      { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
      headers,
    )
  const status = new URL(request.url).searchParams.get("status")
  const result = await listSettlements(client, status)
  if (result.error)
    return apiErrorResponse(
      { code: "CONFLICT", message: "Settlements could not be read.", statusCode: 409 },
      headers,
    )
  return apiDataResponse({ data: result.data }, 200, headers)
}

export async function processRefund(request: Request, refundId: string) {
  if (!isTrustedEdgeRequest(request))
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Trusted edge request required.",
      statusCode: 403,
    })
  if (!getSupabaseServiceConfigStatus().configured)
    return apiErrorResponse({
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Supabase is not configured.",
      statusCode: 503,
    })
  if (!hasJsonContentType(request))
    return apiErrorResponse({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json.",
      statusCode: 415,
    })
  const parsed = await parseJsonWithSchema(request, refundResultSchema)
  const id = uuidSchema.safeParse(refundId)
  if (parsed.status !== "success" || !id.success)
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid refund result.",
      statusCode: 422,
    })
  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc("process_refund_result", {
    checked_action: parsed.value.action,
    checked_claim_token: parsed.value.claimToken ?? null,
    checked_failure_code: parsed.value.failureCode ?? null,
    checked_provider_refund_key: parsed.value.providerRefundKey ?? null,
    checked_raw_payload: parsed.value.rawPayload === undefined ? null : parsed.value.rawPayload,
    checked_refund_id: id.data,
  })
  if (error)
    return apiErrorResponse({
      code: error.code === "23505" ? "CONFLICT" : "INVALID_STATE_TRANSITION",
      message: "Refund result conflicts with the current state.",
      statusCode: 409,
    })
  return apiDataResponse({ data: data?.[0] ?? null }, 200)
}

export async function generateSettlement(request: Request, reservationId: string) {
  if (!isTrustedEdgeRequest(request))
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Trusted edge request required.",
      statusCode: 403,
    })
  const id = uuidSchema.safeParse(reservationId)
  if (!id.success || !getSupabaseServiceConfigStatus().configured)
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid settlement request.",
      statusCode: 422,
    })
  return generateSettlementWithId(id.data)
}

export async function generateSettlementFromBody(request: Request) {
  if (!isTrustedEdgeRequest(request) || !hasJsonContentType(request))
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Trusted edge JSON request required.",
      statusCode: 403,
    })
  if (!getSupabaseServiceConfigStatus().configured)
    return apiErrorResponse({
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Supabase is not configured.",
      statusCode: 503,
    })
  const parsed = await parseJsonWithSchema(request, settlementGenerateSchema)
  if (parsed.status !== "success")
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid settlement request.",
      statusCode: 422,
    })
  return generateSettlementWithId(parsed.value.reservationId)
}

export async function claimRefund(request: Request, refundId: string) {
  if (!isTrustedEdgeRequest(request) || !hasJsonContentType(request))
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Trusted edge JSON request required.",
      statusCode: 403,
    })
  const id = uuidSchema.safeParse(refundId)
  const parsed = await parseJsonWithSchema(request, refundClaimSchema)
  if (!id.success || parsed.status !== "success")
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid refund claim.",
      statusCode: 422,
    })
  if (!getSupabaseServiceConfigStatus().configured)
    return apiErrorResponse({
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Supabase is not configured.",
      statusCode: 503,
    })
  const { data, error } = await createSupabaseServiceClient().rpc("claim_refund", {
    checked_idempotency_key: parsed.value.idempotencyKey,
    checked_refund_id: id.data,
  })
  if (error)
    return apiErrorResponse({
      code: error.code === "55P03" ? "CONFLICT" : "INVALID_STATE_TRANSITION",
      message: "Refund cannot be claimed.",
      statusCode: 409,
    })
  return apiDataResponse({ data: data?.[0] ?? null }, 200)
}

async function generateSettlementWithId(reservationId: string) {
  const { data, error } = await createSupabaseServiceClient().rpc("generate_settlement", {
    checked_reservation_id: reservationId,
  })
  if (error)
    return apiErrorResponse({
      code: "INVALID_STATE_TRANSITION",
      message: "Reservation is not eligible for settlement.",
      statusCode: 409,
    })
  return apiDataResponse({ data: data?.[0] ?? null }, 200)
}

export async function changeSettlementStatus(
  request: Request,
  settlementId: string,
  action: "approve" | "hold",
) {
  if (!hasSameOrigin(request) || !hasJsonContentType(request))
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Same-origin JSON request required.",
      statusCode: 403,
    })
  const id = uuidSchema.safeParse(settlementId)
  if (!id.success)
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid settlement id.",
      statusCode: 422,
    })
  const parsed =
    action === "hold"
      ? await parseJsonWithSchema(request, settlementHoldSchema)
      : { status: "success" as const, value: {} }
  if (parsed.status !== "success")
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Invalid settlement action.",
      statusCode: 422,
    })
  const headers = new Headers()
  const client = await createSupabaseServerClient(headers)
  const user = await client.auth.getUser()
  if (user.error || !user.data.user)
    return apiErrorResponse(
      { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
      headers,
    )
  const holdReason = "reason" in parsed.value ? parsed.value.reason : null
  const { data, error } = await client.rpc("set_settlement_status", {
    checked_action: action,
    checked_hold_reason: holdReason,
    checked_settlement_id: id.data,
  })
  if (error)
    return apiErrorResponse(
      {
        code: error.code === "42501" ? "FORBIDDEN" : "CONFLICT",
        message: "Settlement status could not be changed.",
        statusCode: error.code === "42501" ? 403 : 409,
      },
      headers,
    )
  return apiDataResponse({ data: data?.[0] ?? null }, 200, headers)
}

function isTrustedEdgeRequest(request: Request) {
  return (
    getEdgeRuntimeConfigStatus().configured &&
    isAuthorizedEdgeRequestHeader(
      request.headers.get("authorization"),
      readEdgeRuntimeEnv().edgeSecret,
    )
  )
}
