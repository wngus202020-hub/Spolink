import { apiDataResponse, apiErrorResponse } from "@/lib/api/responses"
import { hasJsonContentType, parseJsonWithSchema } from "@/lib/auth/route-security"
import { isAuthorizedEdgeRequestHeader } from "@/lib/payments/edge-auth"
import {
  getEdgeRuntimeConfigStatus,
  getSupabaseServiceConfigStatus,
  getWebPushConfigStatus,
  readEdgeRuntimeEnv,
} from "@/lib/supabase/env"
import { pushDeliveryBatchSchema } from "./push-contract"
import {
  createPushDeliveryDependencies,
  PushDeliveryPersistenceError,
} from "./push-delivery-defaults"
import { runPushDeliveryBatch } from "./push-delivery-worker"

export async function deliverPendingPushNotifications(request: Request) {
  if (
    !getEdgeRuntimeConfigStatus().configured ||
    !isAuthorizedEdgeRequestHeader(
      request.headers.get("authorization"),
      readEdgeRuntimeEnv().edgeSecret,
    )
  ) {
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Trusted push worker required.",
      statusCode: 403,
    })
  }
  if (!hasJsonContentType(request)) {
    return apiErrorResponse({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json.",
      statusCode: 415,
    })
  }
  const parsed = await parseJsonWithSchema(request, pushDeliveryBatchSchema)
  if (parsed.status !== "success") {
    return apiErrorResponse({
      code: "VALIDATION_ERROR",
      message: "Push delivery request is invalid.",
      statusCode: 422,
    })
  }
  if (!getSupabaseServiceConfigStatus().configured || !getWebPushConfigStatus().configured) {
    return apiErrorResponse({
      code: "PUSH_NOT_CONFIGURED",
      message: "Push delivery is not configured.",
      statusCode: 503,
    })
  }

  try {
    const result = await runPushDeliveryBatch(parsed.value.limit, createPushDeliveryDependencies())
    return apiDataResponse({ data: result }, 200)
  } catch (error) {
    if (error instanceof PushDeliveryPersistenceError) {
      return apiErrorResponse({
        code: "PUSH_DELIVERY_CONFLICT",
        message: "Push delivery state could not be persisted.",
        statusCode: 409,
      })
    }
    throw error
  }
}
