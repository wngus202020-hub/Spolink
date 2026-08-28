import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import { createBlockSchema, createReportSchema, parsePageQuery } from "./contract"
import type { TrustSafetyDependencies } from "./types"
import { runCreateBlock, runCreateReport, runListBlocks, runListReports } from "./workflow"

type RouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<TrustSafetyDependencies>
  isSupabaseConfigured: () => boolean
}>

export function createListReportsRouteHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    const query = parsePageQuery(new URL(request.url).searchParams)
    if (!query) return validationError()
    return runConfigured(dependencies, (workflow) => runListReports(query, workflow))
  }
}

export function createCreateReportRouteHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const boundary = mutationBoundary(request)
    if (boundary) return boundary
    const parsed = await parseJsonWithSchema(request, createReportSchema)
    if (parsed.status !== "success") return validationError()
    return runConfigured(dependencies, (workflow) =>
      runCreateReport(
        {
          detail: parsed.value.detail ?? null,
          reason: parsed.value.reason,
          targetId: parsed.value.targetId,
          targetType: parsed.value.targetType,
        },
        workflow,
      ),
    )
  }
}

export function createListBlocksRouteHandler(dependencies: RouteDependencies) {
  return async function GET(request: Request) {
    const query = parsePageQuery(new URL(request.url).searchParams)
    if (!query) return validationError()
    return runConfigured(dependencies, (workflow) => runListBlocks(query, workflow))
  }
}

export function createCreateBlockRouteHandler(dependencies: RouteDependencies) {
  return async function POST(request: Request) {
    const boundary = mutationBoundary(request)
    if (boundary) return boundary
    const parsed = await parseJsonWithSchema(request, createBlockSchema)
    if (parsed.status !== "success") return validationError()
    return runConfigured(dependencies, (workflow) =>
      runCreateBlock(
        { blockedId: parsed.value.blockedId, reason: parsed.value.reason ?? null },
        workflow,
      ),
    )
  }
}

async function runConfigured<T>(
  dependencies: RouteDependencies,
  run: (workflow: TrustSafetyDependencies) => Promise<WorkflowResult<T>>,
) {
  if (!dependencies.isSupabaseConfigured()) return notConfigured()
  const headers = new Headers()
  const result = await run(await dependencies.createWorkflowDependencies(headers))
  return workflowResponse(result, headers)
}

function mutationBoundary(request: Request) {
  if (!hasSameOrigin(request)) {
    return apiErrorResponse({
      code: "FORBIDDEN",
      message: "Same-origin required.",
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
  return null
}

function workflowResponse<T>(result: WorkflowResult<T>, headers: Headers) {
  return result.status === "failure"
    ? apiErrorResponse(result.error, headers)
    : apiDataResponse(result.response, result.statusCode, headers)
}

function validationError() {
  return apiErrorResponse({
    code: "VALIDATION_ERROR",
    message: "Invalid trust and safety request.",
    statusCode: 422,
  })
}

function notConfigured() {
  return apiErrorResponse({
    code: "SUPABASE_NOT_CONFIGURED",
    message: "Supabase is not configured.",
    statusCode: 503,
  })
}
