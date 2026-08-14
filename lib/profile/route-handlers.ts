import type { SupabaseClient } from "@supabase/supabase-js"

import { readRequestJson } from "../api/json"
import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin } from "../auth/route-security"
import type { Database } from "../supabase/database.types"
import type { ProfileWorkflowDependencies } from "./types"
import { parseCreateProfileRequest, parsePatchProfileRequest } from "./validation"
import {
  runCreateProfileWorkflow,
  runGetCurrentProfileWorkflow,
  runPatchProfileWorkflow,
} from "./workflow"

type SupabaseAppClient = SupabaseClient<Database>

export type ProfileRouteDependencies = Readonly<{
  createSupabaseClient: (responseHeaders: Headers) => Promise<SupabaseAppClient>
  createWorkflowDependencies: (supabase: SupabaseAppClient) => ProfileWorkflowDependencies
  isSupabaseConfigured: () => boolean
}>

export function createGetCurrentProfileRouteHandler(dependencies: ProfileRouteDependencies) {
  return async function GET() {
    if (!dependencies.isSupabaseConfigured()) {
      return supabaseNotConfiguredResponse()
    }

    const responseHeaders = new Headers()
    const supabase = await dependencies.createSupabaseClient(responseHeaders)
    const result = await runGetCurrentProfileWorkflow(
      dependencies.createWorkflowDependencies(supabase),
    )

    if (result.status === "failure") {
      return apiErrorResponse(result.error, responseHeaders)
    }

    return apiDataResponse(result.response, result.statusCode, responseHeaders)
  }
}

export function createPostProfileRouteHandler(dependencies: ProfileRouteDependencies) {
  return async function POST(request: Request) {
    if (!hasSameOrigin(request)) {
      return sameOriginRequiredResponse()
    }

    if (!hasJsonContentType(request)) {
      return unsupportedMediaTypeResponse()
    }

    const requestJson = await readRequestJson(request)

    if (requestJson.status === "failure") {
      return invalidJsonResponse()
    }

    const parsedRequest = parseCreateProfileRequest(requestJson.value)

    if (parsedRequest.status === "failure") {
      return invalidProfileRequestResponse()
    }

    if (!dependencies.isSupabaseConfigured()) {
      return supabaseNotConfiguredResponse()
    }

    const responseHeaders = new Headers()
    const supabase = await dependencies.createSupabaseClient(responseHeaders)
    const result = await runCreateProfileWorkflow(
      parsedRequest.request,
      dependencies.createWorkflowDependencies(supabase),
    )

    if (result.status === "failure") {
      return apiErrorResponse(result.error, responseHeaders)
    }

    return apiDataResponse(result.response, result.statusCode, responseHeaders)
  }
}

export function createPatchProfileRouteHandler(dependencies: ProfileRouteDependencies) {
  return async function PATCH(request: Request) {
    if (!hasSameOrigin(request)) {
      return sameOriginRequiredResponse()
    }

    if (!hasJsonContentType(request)) {
      return unsupportedMediaTypeResponse()
    }

    const requestJson = await readRequestJson(request)

    if (requestJson.status === "failure") {
      return invalidJsonResponse()
    }

    const parsedRequest = parsePatchProfileRequest(requestJson.value)

    if (parsedRequest.status === "failure") {
      return invalidProfileRequestResponse()
    }

    if (!dependencies.isSupabaseConfigured()) {
      return supabaseNotConfiguredResponse()
    }

    const responseHeaders = new Headers()
    const supabase = await dependencies.createSupabaseClient(responseHeaders)
    const result = await runPatchProfileWorkflow(
      parsedRequest.request,
      dependencies.createWorkflowDependencies(supabase),
    )

    if (result.status === "failure") {
      return apiErrorResponse(result.error, responseHeaders)
    }

    return apiDataResponse(result.response, result.statusCode, responseHeaders)
  }
}

function invalidJsonResponse() {
  return apiErrorResponse({
    code: "VALIDATION_ERROR",
    message: "Request body must be valid JSON.",
    statusCode: 422,
  })
}

function sameOriginRequiredResponse() {
  return apiErrorResponse({
    code: "FORBIDDEN",
    message: "Same-origin request required.",
    statusCode: 403,
  })
}

function unsupportedMediaTypeResponse() {
  return apiErrorResponse({
    code: "UNSUPPORTED_MEDIA_TYPE",
    message: "Content-Type must be application/json.",
    statusCode: 415,
  })
}

function invalidProfileRequestResponse() {
  return apiErrorResponse({
    code: "VALIDATION_ERROR",
    message: "Invalid profile request.",
    statusCode: 422,
  })
}

function supabaseNotConfiguredResponse() {
  return apiErrorResponse({
    code: "SUPABASE_NOT_CONFIGURED",
    message: "Supabase is not configured.",
    statusCode: 503,
  })
}
