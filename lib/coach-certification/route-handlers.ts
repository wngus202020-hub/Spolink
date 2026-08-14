import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { CoachSubmissionDependencies } from "./submission"
import { runSubmitCoachApplicationWorkflow } from "./submission"

const emptySubmissionRequestSchema = z.strictObject({})

export type SubmitCoachApplicationRouteDependencies = Readonly<{
  createWorkflowDependencies: () => CoachSubmissionDependencies
  isSupabaseConfigured: () => boolean
}>

export function createSubmitCoachApplicationRouteHandler(
  dependencies: SubmitCoachApplicationRouteDependencies,
) {
  return async function POST(request: Request) {
    if (!hasSameOrigin(request)) return error("FORBIDDEN", "Same-origin request required.", 403)
    if (!hasJsonContentType(request)) {
      return error("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
    }

    const parsed = await parseJsonWithSchema(request, emptySubmissionRequestSchema)
    if (parsed.status !== "success") {
      return error("VALIDATION_ERROR", "Request body must be an empty JSON object.", 422)
    }
    if (!dependencies.isSupabaseConfigured()) {
      return error("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
    }

    const result = await runSubmitCoachApplicationWorkflow(
      dependencies.createWorkflowDependencies(),
    )
    if (result.status === "failure") return apiErrorResponse(result.error)

    return apiDataResponse(result.response, result.statusCode)
  }
}

function error(code: string, message: string, statusCode: number) {
  return apiErrorResponse({ code, message, statusCode })
}
