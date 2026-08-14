import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import type { AdminReviewDependencies } from "./admin-types"
import {
  runCreateAdminCertificateRead,
  runListAdminCoachApplications,
  runReadAdminCoachApplication,
  runReviewAdminCoachApplication,
} from "./admin-workflow"
import { parseAdminCoachListQuery } from "./contract"

const coachProfileIdSchema = z.uuid()
const approveSchema = z.strictObject({})
const rejectSchema = z.strictObject({ rejectionReason: z.string().trim().min(1).max(1000) })

export type AdminRouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<AdminReviewDependencies>
  isSupabaseConfigured: () => boolean
}>

type CoachProfileContext = Readonly<{
  params: Promise<Readonly<{ coachProfileId: string }>>
}>

type CertificateContext = Readonly<{
  params: Promise<Readonly<{ certificateId: string; coachProfileId: string }>>
}>

export function createListAdminCoachProfilesRouteHandler(dependencies: AdminRouteDependencies) {
  return async function GET(request: Request) {
    const query = parseAdminCoachListQuery(new URL(request.url).searchParams)
    if (!query) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runListAdminCoachApplications(query, workflowDependencies),
      headers,
    )
  }
}

export function createGetAdminCoachProfileRouteHandler(dependencies: AdminRouteDependencies) {
  return async function GET(_request: Request, context: CoachProfileContext) {
    const coachProfileId = await readCoachProfileId(context)
    if (!coachProfileId) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runReadAdminCoachApplication(coachProfileId, workflowDependencies),
      headers,
    )
  }
}

export function createApproveCoachProfileRouteHandler(dependencies: AdminRouteDependencies) {
  return createReviewHandler(dependencies, "approve")
}

export function createRejectCoachProfileRouteHandler(dependencies: AdminRouteDependencies) {
  return createReviewHandler(dependencies, "reject")
}

export function createAdminCertificateReadRouteHandler(dependencies: AdminRouteDependencies) {
  return async function GET(_request: Request, context: CertificateContext) {
    const params = await context.params
    const coachProfileId = coachProfileIdSchema.safeParse(params.coachProfileId)
    const certificateId = coachProfileIdSchema.safeParse(params.certificateId)
    if (!coachProfileId.success || !certificateId.success) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runCreateAdminCertificateRead(
        coachProfileId.data,
        certificateId.data,
        workflowDependencies,
      ),
      headers,
    )
  }
}

function createReviewHandler(dependencies: AdminRouteDependencies, decision: "approve" | "reject") {
  return async function POST(request: Request, context: CoachProfileContext) {
    if (!hasSameOrigin(request)) return boundaryError("FORBIDDEN", "Same-origin required.", 403)
    if (!hasJsonContentType(request)) {
      return boundaryError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
    }
    const parsed = await parseJsonWithSchema(
      request,
      decision === "approve" ? approveSchema : rejectSchema,
    )
    if (parsed.status !== "success") return validationError()
    const coachProfileId = await readCoachProfileId(context)
    if (!coachProfileId) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    const rejectionReason = decision === "reject" ? readRejectionReason(parsed.value) : null
    if (decision === "reject" && !rejectionReason) return validationError()
    return workflowResponse(
      await runReviewAdminCoachApplication(
        coachProfileId,
        decision,
        rejectionReason,
        workflowDependencies,
      ),
      headers,
    )
  }
}

function readRejectionReason(value: object): string | null {
  const parsed = rejectSchema.safeParse(value)
  return parsed.success ? parsed.data.rejectionReason : null
}

async function readCoachProfileId(context: CoachProfileContext) {
  const params = await context.params
  const parsed = coachProfileIdSchema.safeParse(params.coachProfileId)
  return parsed.success ? parsed.data : null
}

function workflowResponse<T>(result: WorkflowResult<T>, headers: Headers) {
  return result.status === "failure"
    ? apiErrorResponse(result.error, headers)
    : apiDataResponse(result.response, result.statusCode, headers)
}

function boundaryError(code: string, message: string, statusCode: number) {
  return apiErrorResponse({ code, message, statusCode })
}

function validationError() {
  return boundaryError("VALIDATION_ERROR", "Invalid administrator review request.", 422)
}

function notConfigured() {
  return boundaryError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
}
