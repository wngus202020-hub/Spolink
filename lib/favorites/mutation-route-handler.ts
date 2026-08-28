import { readRequestJson } from "../api/json"
import { apiDataResponse, apiErrorResponse } from "../api/responses"
import type { FavoriteMutationClient } from "./mutation-session"
import type {
  FavoriteMutationAction,
  FavoriteMutationWorkflowDependencies,
  FavoriteMutationWorkflowInput,
  FavoriteMutationWorkflowResult,
} from "./mutation-workflow"
import { parseFavoriteMutationRequest } from "./mutation-workflow"

type FavoriteMutationSession = Readonly<{
  getVerifiedUserId: () => Promise<string | null>
  workflowDependencies: FavoriteMutationWorkflowDependencies
}>

type FavoriteMutationRouteDependencies = Readonly<{
  createSession: (responseHeaders: Headers) => Promise<FavoriteMutationSession>
  isConfigured: () => boolean
  runWorkflow: (
    input: FavoriteMutationWorkflowInput,
    dependencies: FavoriteMutationWorkflowDependencies,
  ) => Promise<FavoriteMutationWorkflowResult>
}>

export function createFavoriteMutationRouteHandler(
  action: FavoriteMutationAction,
  dependencies: FavoriteMutationRouteDependencies,
) {
  return async function handleFavoriteMutation(request: Request): Promise<Response> {
    if (!hasSameOrigin(request))
      return boundaryError("FORBIDDEN", "Same-origin request required.", 403)
    if (!hasJsonContentType(request)) {
      return boundaryError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
    }

    const json = await readRequestJson(request)
    if (json.status === "failure") {
      return boundaryError("VALIDATION_ERROR", "Request body must be valid JSON.", 422)
    }

    const parsed = parseFavoriteMutationRequest(json.value)
    if (parsed.status === "failure") {
      return boundaryError("VALIDATION_ERROR", "Favorite request is invalid.", 422)
    }

    if (!dependencies.isConfigured()) {
      return boundaryError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
    }

    const responseHeaders = new Headers()
    const session = await dependencies.createSession(responseHeaders)
    const userId = await session.getVerifiedUserId()
    if (!userId) {
      return apiErrorResponse(
        { code: "UNAUTHORIZED", message: "Authentication required.", statusCode: 401 },
        responseHeaders,
      )
    }

    const result = await dependencies.runWorkflow(
      { action, request: parsed.request, userId },
      session.workflowDependencies,
    )
    return result.status === "failure"
      ? apiErrorResponse(result.error, responseHeaders)
      : apiDataResponse(result.response, result.statusCode, responseHeaders)
  }
}

export async function getVerifiedFavoriteUserId(client: FavoriteMutationClient) {
  const { data, error } = await client.auth.getClaims()
  const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null
  return error || !userId ? null : userId
}

function boundaryError(code: string, message: string, statusCode: number) {
  return apiErrorResponse({ code, message, statusCode })
}

function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const requestUrl = new URL(request.url)
    if (originUrl.origin === requestUrl.origin) return true

    const host = request.headers.get("host")
    return host !== null && originUrl.origin === new URL(`${requestUrl.protocol}//${host}`).origin
  } catch (error) {
    if (error instanceof TypeError) return false
    throw error
  }
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type")
  if (!contentType) return false

  const mediaType = contentType.split(";", 1)[0] ?? ""
  return mediaType.trim().toLowerCase() === "application/json"
}
