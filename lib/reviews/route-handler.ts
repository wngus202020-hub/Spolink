import { readRequestJson } from "@/lib/api/json"
import { apiDataResponse, apiErrorResponse } from "@/lib/api/responses"
import {
  parseCreateReview,
  parseHideReview,
  type ReviewWorkflowDependencies,
  runCreateReview,
  runHideReview,
} from "./workflow"

type Deps = Readonly<{
  createClient: (
    headers: Headers,
  ) => Promise<{ client: ReviewWorkflowDependencies; userId: string | null }>
  configured: () => boolean
}>
export function createReviewRouteHandler(deps: Deps) {
  return async (request: Request) => {
    const boundary = boundaryCheck(request)
    if (boundary) return boundary
    const json = await readRequestJson(request)
    if (json.status === "failure") return error("VALIDATION_ERROR", 422)
    const parsed = parseCreateReview(json.value)
    if (!parsed.success) return error("VALIDATION_ERROR", 422)
    if (!deps.configured()) return error("SUPABASE_NOT_CONFIGURED", 503)
    const headers = new Headers()
    const session = await deps.createClient(headers)
    if (!session.userId)
      return apiErrorResponse(
        { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
        headers,
      )
    const result = await runCreateReview(parsed.data, session.client)
    return result.status === "failure"
      ? apiErrorResponse(result.error, headers)
      : apiDataResponse(result.response, result.statusCode, headers)
  }
}
export function createHideReviewRouteHandler(deps: Deps) {
  return async (request: Request, context: { params: Promise<{ reviewId: string }> }) => {
    const boundary = boundaryCheck(request)
    if (boundary) return boundary
    const json = await readRequestJson(request)
    if (json.status === "failure") return error("VALIDATION_ERROR", 422)
    const parsed = parseHideReview(json.value)
    if (!parsed.success) return error("VALIDATION_ERROR", 422)
    const reviewId = (await context.params).reviewId
    if (!/^[0-9a-f-]{36}$/iu.test(reviewId)) return error("VALIDATION_ERROR", 422)
    if (!deps.configured()) return error("SUPABASE_NOT_CONFIGURED", 503)
    const headers = new Headers()
    const session = await deps.createClient(headers)
    if (!session.userId)
      return apiErrorResponse(
        { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
        headers,
      )
    const result = await runHideReview({ ...parsed.data, reviewId }, session.client)
    return result.status === "failure"
      ? apiErrorResponse(result.error, headers)
      : apiDataResponse(result.response, result.statusCode, headers)
  }
}
function boundaryCheck(request: Request): Response | null {
  try {
    const origin = request.headers.get("origin")
    const requestUrl = new URL(request.url)
    const effectiveOrigin =
      origin ??
      readRefererOrigin(request.headers.get("referer")) ??
      (request.headers.get("sec-fetch-site") === "same-origin" ? requestUrl.origin : null)
    const hostOrigin = request.headers.get("host")
      ? new URL(`${requestUrl.protocol}//${request.headers.get("host")}`).origin
      : null
    if (
      !effectiveOrigin ||
      (new URL(effectiveOrigin).origin !== requestUrl.origin &&
        new URL(effectiveOrigin).origin !== hostOrigin)
    )
      return error("FORBIDDEN", 403)
  } catch {
    return error("FORBIDDEN", 403)
  }
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
    ? null
    : error("UNSUPPORTED_MEDIA_TYPE", 415)
}

function readRefererOrigin(referer: string | null): string | null {
  if (!referer) return null
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}
function error(code: string, statusCode: number) {
  return apiErrorResponse({ code, message: "Review request is invalid.", statusCode })
}
