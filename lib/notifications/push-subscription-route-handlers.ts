import type { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "@/lib/api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "@/lib/auth/route-security"
import { pushSubscriptionDisableSchema, pushSubscriptionSchema } from "./push-contract"
import type { PushSubscriptionRepository } from "./push-subscription-repository"

type PushAccess = Readonly<{ profileId: string }> | "restricted" | "unauthenticated"

type PushSubscriptionContext = Readonly<{
  access: PushAccess
  repository: PushSubscriptionRepository
}>

type PushSubscriptionRouteDependencies = Readonly<{
  createContext: (headers: Headers) => Promise<PushSubscriptionContext>
  isPushConfigured: () => boolean
  isSupabaseConfigured: () => boolean
}>

export function createPushSubscriptionRouteHandler(
  dependencies: PushSubscriptionRouteDependencies,
) {
  async function POST(request: Request) {
    const parsed = await parseMutation(request, pushSubscriptionSchema)
    if (parsed.status === "response") return parsed.response
    if (!dependencies.isPushConfigured()) return pushNotConfigured()

    const headers = new Headers()
    const context = await dependencies.createContext(headers)
    if (context.access === "unauthenticated") return unauthorized(headers)
    if (context.access === "restricted") return forbidden(headers)
    const result = await context.repository.save(context.access.profileId, parsed.value)
    return result === "saved"
      ? apiDataResponse({ data: { subscribed: true } }, 200, headers)
      : repositoryError(headers)
  }

  async function DELETE(request: Request) {
    const parsed = await parseMutation(request, pushSubscriptionDisableSchema)
    if (parsed.status === "response") return parsed.response

    const headers = new Headers()
    const context = await dependencies.createContext(headers)
    if (context.access === "unauthenticated") return unauthorized(headers)
    if (context.access === "restricted") return forbidden(headers)
    const result = await context.repository.disable(context.access.profileId, parsed.value)
    return result === "error"
      ? repositoryError(headers)
      : apiDataResponse({ data: { subscribed: false } }, 200, headers)
  }

  return { DELETE, POST }

  async function parseMutation<T>(request: Request, schema: z.ZodType<T>) {
    if (!hasSameOrigin(request)) return { response: forbidden(), status: "response" as const }
    if (!hasJsonContentType(request)) {
      return {
        response: apiErrorResponse({
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Content-Type must be application/json.",
          statusCode: 415,
        }),
        status: "response" as const,
      }
    }
    const parsed = await parseJsonWithSchema(request, schema)
    if (parsed.status !== "success") {
      return {
        response: apiErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Push subscription is invalid.",
          statusCode: 422,
        }),
        status: "response" as const,
      }
    }
    if (!dependencies.isSupabaseConfigured()) {
      return {
        response: apiErrorResponse({
          code: "SUPABASE_NOT_CONFIGURED",
          message: "Supabase is not configured.",
          statusCode: 503,
        }),
        status: "response" as const,
      }
    }
    return { status: "value" as const, value: parsed.value }
  }
}

function unauthorized(headers: Headers) {
  return apiErrorResponse(
    { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
    headers,
  )
}

function forbidden(headers?: Headers) {
  return apiErrorResponse(
    { code: "FORBIDDEN", message: "Push subscription is forbidden.", statusCode: 403 },
    headers,
  )
}

function pushNotConfigured() {
  return apiErrorResponse({
    code: "PUSH_NOT_CONFIGURED",
    message: "Web Push is not configured.",
    statusCode: 503,
  })
}

function repositoryError(headers: Headers) {
  return apiErrorResponse(
    { code: "INTERNAL_ERROR", message: "Push subscription could not be saved.", statusCode: 500 },
    headers,
  )
}
