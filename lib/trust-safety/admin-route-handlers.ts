import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import { parseAdminReportQuery, resolveReportSchema } from "./contract"
import type { AdminTrustSafetyDependencies } from "./types"
import { runListAdminReports, runReadAdminReport, runResolveAdminReport } from "./workflow"

const reportIdSchema = z.uuid()

type AdminRouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<AdminTrustSafetyDependencies>
  isSupabaseConfigured: () => boolean
}>

type ReportContext = Readonly<{
  params: Promise<Readonly<{ reportId: string }>>
}>

export function createListAdminReportsRouteHandler(dependencies: AdminRouteDependencies) {
  return async function GET(request: Request) {
    const query = parseAdminReportQuery(new URL(request.url).searchParams)
    if (!query) return validationError()
    return runConfigured(dependencies, (workflow) => runListAdminReports(query, workflow))
  }
}

export function createReadAdminReportRouteHandler(dependencies: AdminRouteDependencies) {
  return async function GET(_request: Request, context: ReportContext) {
    const reportId = await readReportId(context)
    if (!reportId) return validationError()
    return runConfigured(dependencies, (workflow) => runReadAdminReport(reportId, workflow))
  }
}

export function createResolveAdminReportRouteHandler(dependencies: AdminRouteDependencies) {
  return async function POST(request: Request, context: ReportContext) {
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
    const parsed = await parseJsonWithSchema(request, resolveReportSchema)
    const reportId = await readReportId(context)
    if (parsed.status !== "success" || !reportId) return validationError()
    return runConfigured(dependencies, (workflow) =>
      runResolveAdminReport(
        {
          action: parsed.value.action,
          moderationAction: parsed.value.moderationAction,
          reportId,
          resolutionNote: parsed.value.resolutionNote ?? null,
        },
        workflow,
      ),
    )
  }
}

async function readReportId(context: ReportContext) {
  const params = await context.params
  const parsed = reportIdSchema.safeParse(params.reportId)
  return parsed.success ? parsed.data : null
}

async function runConfigured<T>(
  dependencies: AdminRouteDependencies,
  run: (workflow: AdminTrustSafetyDependencies) => Promise<WorkflowResult<T>>,
) {
  if (!dependencies.isSupabaseConfigured()) {
    return apiErrorResponse({
      code: "SUPABASE_NOT_CONFIGURED",
      message: "Supabase is not configured.",
      statusCode: 503,
    })
  }
  const headers = new Headers()
  const result = await run(await dependencies.createWorkflowDependencies(headers))
  return result.status === "failure"
    ? apiErrorResponse(result.error, headers)
    : apiDataResponse(result.response, result.statusCode, headers)
}

function validationError() {
  return apiErrorResponse({
    code: "VALIDATION_ERROR",
    message: "Invalid moderation request.",
    statusCode: 422,
  })
}
