import { z } from "zod"
import { apiDataResponse, apiErrorResponse } from "@/lib/api/responses"
import { decodeNotificationCursor } from "./types"
import {
  type NotificationWorkflowDependencies,
  runListNotifications,
  runMarkNotificationRead,
} from "./workflow"

const querySchema = z.object({
  cursor: z.string().trim().min(1).nullable().default(null),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z.enum(["true", "false"]).default("false"),
})
const notificationIdSchema = z.string().uuid()

export function createNotificationRouteDependencies(
  createDependencies: (headers: Headers) => Promise<NotificationWorkflowDependencies>,
  isConfigured: () => boolean,
) {
  return { createDependencies, isConfigured }
}

export function createListNotificationsRouteHandler(
  dependencies: ReturnType<typeof createNotificationRouteDependencies>,
) {
  return async (request: Request) => {
    const headers = new Headers()
    if (!dependencies.isConfigured())
      return apiErrorResponse({
        code: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase is not configured.",
        statusCode: 503,
      })
    const url = new URL(request.url)
    const parsed = querySchema.safeParse({
      cursor: url.searchParams.get("cursor"),
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      unreadOnly: url.searchParams.get("unreadOnly") ?? undefined,
    })
    const cursor = parsed.success ? decodeNotificationCursor(parsed.data.cursor) : null
    if (!parsed.success || (url.searchParams.has("cursor") && !cursor))
      return apiErrorResponse({
        code: "VALIDATION_ERROR",
        message: "Notification query is invalid.",
        statusCode: 422,
      })
    const result = await runListNotifications(
      {
        cursor,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        unreadOnly: parsed.data.unreadOnly === "true",
      },
      await dependencies.createDependencies(headers),
    )
    return result.status === "failure"
      ? apiErrorResponse(result.error, headers)
      : apiDataResponse(result.response, 200, headers)
  }
}

export function createMarkNotificationReadRouteHandler(
  dependencies: ReturnType<typeof createNotificationRouteDependencies>,
) {
  return async (request: Request, context: { params: Promise<{ notificationId: string }> }) => {
    const headers = new Headers()
    if (!sameOrigin(request))
      return apiErrorResponse({
        code: "FORBIDDEN",
        message: "Same-origin request required.",
        statusCode: 403,
      })
    if (
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "application/json"
    )
      return apiErrorResponse({
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json.",
        statusCode: 415,
      })
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiErrorResponse({
        code: "VALIDATION_ERROR",
        message: "Request body must be valid JSON.",
        statusCode: 422,
      })
    }
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      return apiErrorResponse({
        code: "VALIDATION_ERROR",
        message: "Notification read request is invalid.",
        statusCode: 422,
      })
    const { notificationId } = await context.params
    if (!notificationIdSchema.safeParse(notificationId).success)
      return apiErrorResponse({
        code: "VALIDATION_ERROR",
        message: "Notification read request is invalid.",
        statusCode: 422,
      })
    if (!dependencies.isConfigured())
      return apiErrorResponse({
        code: "SUPABASE_NOT_CONFIGURED",
        message: "Supabase is not configured.",
        statusCode: 503,
      })
    const result = await runMarkNotificationRead(
      notificationId,
      await dependencies.createDependencies(headers),
    )
    return result.status === "failure"
      ? apiErrorResponse(result.error, headers)
      : apiDataResponse(result.response, 200, headers)
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) {
    if (request.headers.get("sec-fetch-site") === "same-origin") return true
    const referer = request.headers.get("referer")
    if (!referer) return false
    try {
      return requestOrigins(request).has(new URL(referer).origin)
    } catch {
      return false
    }
  }
  try {
    return requestOrigins(request).has(new URL(origin).origin)
  } catch {
    return false
  }
}

function requestOrigins(request: Request): ReadonlySet<string> {
  const url = new URL(request.url)
  const host = request.headers.get("host")
  return new Set([url.origin, ...(host ? [`${url.protocol}//${host}`] : [])])
}
