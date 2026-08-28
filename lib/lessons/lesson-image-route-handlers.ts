import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import {
  type LessonImageErrorCode,
  type LessonImageErrorResult,
  lessonImageDeleteRequestSchema,
  lessonImageOrderRequestSchema,
  lessonImageRegistrationRequestSchema,
  lessonImageUploadIntentRequestSchema,
} from "./lesson-image-contract"
import type { LessonImageWorkflowDependencies } from "./lesson-image-types"
import {
  runDeleteLessonImage,
  runIssueLessonImageUploadIntent,
  runRegisterLessonImage,
  runReorderLessonImages,
} from "./lesson-image-workflow"

export type LessonImageRouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<LessonImageWorkflowDependencies>
  isSupabaseConfigured: () => boolean
}>

type LessonContext = Readonly<{ params: Promise<Readonly<{ lessonId: string }>> }>
type ImageContext = Readonly<{
  params: Promise<Readonly<{ imageId: string; lessonId: string }>>
}>

const idSchema = z.uuid()
const MESSAGES: Record<LessonImageErrorCode, string> = {
  CONFLICT: "이미지 상태가 변경되었습니다. 다시 시도해 주세요.",
  FORBIDDEN: "요청을 수행할 권한이 없습니다.",
  NOT_FOUND: "요청한 이미지 리소스를 찾을 수 없습니다.",
  UNAUTHENTICATED: "로그인이 필요합니다.",
  UNAVAILABLE: "현재 이미지 요청을 처리할 수 없습니다.",
  UNSUPPORTED_MEDIA_TYPE: "application/json 요청만 지원합니다.",
  VALIDATION_ERROR: "요청 값을 확인해 주세요.",
}

export function createIssueLessonImageUploadIntentRouteHandler(
  dependencies: LessonImageRouteDependencies,
) {
  return async function POST(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, lessonImageUploadIntentRequestSchema)
    if (!parsed.success) return parsed.response
    const lessonId = idSchema.safeParse((await context.params).lessonId)
    if (!lessonId.success) return errorResponse("VALIDATION_ERROR")
    const workflow = await createWorkflow(dependencies)
    if (!workflow.success) return workflow.response
    return resultResponse(
      await runIssueLessonImageUploadIntent(lessonId.data, parsed.data, workflow.dependencies),
      201,
      workflow.headers,
    )
  }
}

export function createRegisterLessonImageRouteHandler(dependencies: LessonImageRouteDependencies) {
  return async function POST(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, lessonImageRegistrationRequestSchema)
    if (!parsed.success) return parsed.response
    const lessonId = idSchema.safeParse((await context.params).lessonId)
    if (!lessonId.success) return errorResponse("VALIDATION_ERROR")
    const workflow = await createWorkflow(dependencies)
    if (!workflow.success) return workflow.response
    return resultResponse(
      await runRegisterLessonImage(lessonId.data, parsed.data, workflow.dependencies),
      201,
      workflow.headers,
    )
  }
}

export function createReorderLessonImagesRouteHandler(dependencies: LessonImageRouteDependencies) {
  return async function PATCH(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, lessonImageOrderRequestSchema)
    if (!parsed.success) return parsed.response
    const lessonId = idSchema.safeParse((await context.params).lessonId)
    if (!lessonId.success) return errorResponse("VALIDATION_ERROR")
    const workflow = await createWorkflow(dependencies)
    if (!workflow.success) return workflow.response
    return resultResponse(
      await runReorderLessonImages(lessonId.data, parsed.data, workflow.dependencies),
      200,
      workflow.headers,
    )
  }
}

export function createDeleteLessonImageRouteHandler(dependencies: LessonImageRouteDependencies) {
  return async function DELETE(request: Request, context: ImageContext) {
    const parsed = await parseMutation(request, lessonImageDeleteRequestSchema)
    if (!parsed.success) return parsed.response
    const params = await context.params
    const lessonId = idSchema.safeParse(params.lessonId)
    const imageId = idSchema.safeParse(params.imageId)
    if (!lessonId.success || !imageId.success) return errorResponse("VALIDATION_ERROR")
    const workflow = await createWorkflow(dependencies)
    if (!workflow.success) return workflow.response
    return resultResponse(
      await runDeleteLessonImage(lessonId.data, imageId.data, parsed.data, workflow.dependencies),
      200,
      workflow.headers,
    )
  }
}

async function parseMutation<T>(request: Request, schema: z.ZodType<T>) {
  if (!hasSameOrigin(request))
    return { response: errorResponse("FORBIDDEN"), success: false } as const
  if (!hasJsonContentType(request)) {
    return { response: errorResponse("UNSUPPORTED_MEDIA_TYPE"), success: false } as const
  }
  const parsed = await parseJsonWithSchema(request, schema)
  if (parsed.status !== "success") {
    return { response: errorResponse("VALIDATION_ERROR"), success: false } as const
  }
  return { data: parsed.value, success: true } as const
}

async function createWorkflow(dependencies: LessonImageRouteDependencies) {
  if (!dependencies.isSupabaseConfigured()) {
    return { response: errorResponse("UNAVAILABLE"), success: false } as const
  }
  const headers = new Headers()
  try {
    return {
      dependencies: await dependencies.createWorkflowDependencies(headers),
      headers,
      success: true,
    } as const
  } catch {
    return { response: errorResponse("UNAVAILABLE", headers), success: false } as const
  }
}

function resultResponse<T>(
  result: Readonly<{ data: T; status: "success" }> | LessonImageErrorResult,
  successStatus: number,
  headers: Headers,
) {
  return result.status === "success"
    ? apiDataResponse({ data: result.data }, successStatus, headers)
    : errorResponse(result.code, headers)
}

function errorResponse(code: LessonImageErrorCode, headers?: Headers) {
  const statusCode = {
    CONFLICT: 409,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    UNAUTHENTICATED: 401,
    UNAVAILABLE: 503,
    UNSUPPORTED_MEDIA_TYPE: 415,
    VALIDATION_ERROR: 422,
  }[code]
  return apiErrorResponse({ code, message: MESSAGES[code], statusCode }, headers)
}
