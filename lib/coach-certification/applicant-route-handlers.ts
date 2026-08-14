import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import type { ApplicantWorkflowDependencies } from "./applicant-types"
import {
  runCreateCertificateUpload,
  runDeleteCertificate,
  runReadCoachApplication,
  runRegisterCertificate,
  runSaveCoachApplication,
} from "./applicant-workflow"
import { coachApplicationRequestSchema } from "./contract"

const uploadSchema = z.strictObject({
  mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
})
const certificateSchema = z.strictObject({
  certificateName: z.string().trim().min(1).max(120),
  certificateNumber: z.string().trim().min(1).max(100).nullable().optional(),
  issuer: z.string().trim().min(1).max(120).nullable().optional(),
  objectName: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|pdf)$/u,
    ),
})
const certificateIdSchema = z.uuid()
const emptyRequestSchema = z.strictObject({})

export type ApplicantRouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<ApplicantWorkflowDependencies>
  isSupabaseConfigured: () => boolean
}>

export function createGetCoachApplicationRouteHandler(dependencies: ApplicantRouteDependencies) {
  return async function GET() {
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const result = await runReadCoachApplication(
      await dependencies.createWorkflowDependencies(headers),
    )
    return workflowResponse(result, headers)
  }
}

export function createPutCoachApplicationRouteHandler(dependencies: ApplicantRouteDependencies) {
  return async function PUT(request: Request) {
    const boundary = await parseMutation(request, coachApplicationRequestSchema)
    if (boundary.status === "failure") return boundary.response
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const result = await runSaveCoachApplication(
      boundary.value,
      await dependencies.createWorkflowDependencies(headers),
    )
    return workflowResponse(result, headers)
  }
}

export function createCertificateUploadRouteHandler(dependencies: ApplicantRouteDependencies) {
  return async function POST(request: Request) {
    const boundary = await parseMutation(request, uploadSchema)
    if (boundary.status === "failure") return boundary.response
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const result = await runCreateCertificateUpload(
      boundary.value,
      await dependencies.createWorkflowDependencies(headers),
    )
    return workflowResponse(result, headers)
  }
}

export function createRegisterCertificateRouteHandler(dependencies: ApplicantRouteDependencies) {
  return async function POST(request: Request) {
    const boundary = await parseMutation(request, certificateSchema)
    if (boundary.status === "failure") return boundary.response
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const result = await runRegisterCertificate(
      {
        certificateName: boundary.value.certificateName,
        certificateNumber: boundary.value.certificateNumber ?? null,
        issuer: boundary.value.issuer ?? null,
        objectName: boundary.value.objectName,
      },
      await dependencies.createWorkflowDependencies(headers),
    )
    return workflowResponse(result, headers)
  }
}

export function createDeleteCertificateRouteHandler(dependencies: ApplicantRouteDependencies) {
  return async function DELETE(
    request: Request,
    context: Readonly<{ params: Promise<Readonly<{ certificateId: string }>> }>,
  ) {
    const boundary = await parseMutation(request, emptyRequestSchema)
    if (boundary.status === "failure") return boundary.response
    const params = await context.params
    const certificateId = certificateIdSchema.safeParse(params.certificateId)
    if (!certificateId.success) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const result = await runDeleteCertificate(
      certificateId.data,
      await dependencies.createWorkflowDependencies(headers),
    )
    return workflowResponse(result, headers)
  }
}

async function parseMutation<T>(request: Request, schema: z.ZodType<T>) {
  if (!hasSameOrigin(request)) {
    return {
      response: boundaryError("FORBIDDEN", "Same-origin request required.", 403),
      status: "failure" as const,
    }
  }
  if (!hasJsonContentType(request)) {
    return {
      response: boundaryError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json.",
        415,
      ),
      status: "failure" as const,
    }
  }
  const parsed = await parseJsonWithSchema(request, schema)
  if (parsed.status !== "success") {
    return { response: validationError(), status: "failure" as const }
  }
  return { status: "success" as const, value: parsed.value }
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
  return boundaryError("VALIDATION_ERROR", "Invalid coach application request.", 422)
}

function notConfigured() {
  return boundaryError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
}
