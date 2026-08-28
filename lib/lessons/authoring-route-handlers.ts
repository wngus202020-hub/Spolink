import { z } from "zod"

import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { WorkflowResult } from "../profile/types"
import {
  lessonDraftSchema,
  lessonTransitionSchema,
  lessonUpdateSchema,
  scheduleCloseSchema,
  scheduleCreateSchema,
  scheduleUpdateSchema,
} from "./authoring-contract"
import type { LessonAuthoringDependencies } from "./authoring-types"
import {
  runCloseLessonSchedule,
  runCreateLessonDraft,
  runCreateLessonSchedule,
  runTransitionLesson,
  runUpdateLessonDraft,
  runUpdateLessonSchedule,
} from "./authoring-workflow"

const idSchema = z.uuid()

export type LessonAuthoringRouteDependencies = Readonly<{
  createWorkflowDependencies: (headers: Headers) => Promise<LessonAuthoringDependencies>
  isSupabaseConfigured: () => boolean
}>

type LessonContext = Readonly<{ params: Promise<Readonly<{ lessonId: string }>> }>
type ScheduleContext = Readonly<{
  params: Promise<Readonly<{ lessonId: string; scheduleId: string }>>
}>

export function createCreateLessonRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function POST(request: Request) {
    const parsed = await parseMutation(request, lessonDraftSchema)
    if (parsed.status === "failure") return parsed.response
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(await runCreateLessonDraft(parsed.value, workflowDependencies), headers)
  }
}

export function createUpdateLessonRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function PATCH(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, lessonUpdateSchema)
    if (parsed.status === "failure") return parsed.response
    const lessonId = await readLessonId(context)
    if (!lessonId) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runUpdateLessonDraft(lessonId, parsed.value, workflowDependencies),
      headers,
    )
  }
}

export function createTransitionLessonRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function POST(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, lessonTransitionSchema)
    if (parsed.status === "failure") return parsed.response
    const lessonId = await readLessonId(context)
    if (!lessonId) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runTransitionLesson(lessonId, parsed.value, workflowDependencies),
      headers,
    )
  }
}

export function createCreateScheduleRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function POST(request: Request, context: LessonContext) {
    const parsed = await parseMutation(request, scheduleCreateSchema)
    if (parsed.status === "failure") return parsed.response
    const lessonId = await readLessonId(context)
    if (!lessonId) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runCreateLessonSchedule(lessonId, parsed.value, workflowDependencies),
      headers,
    )
  }
}

export function createUpdateScheduleRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function PATCH(request: Request, context: ScheduleContext) {
    const parsed = await parseMutation(request, scheduleUpdateSchema)
    if (parsed.status === "failure") return parsed.response
    const routeIds = await readScheduleIds(context)
    if (!routeIds) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runUpdateLessonSchedule(
        routeIds.lessonId,
        routeIds.scheduleId,
        parsed.value,
        workflowDependencies,
      ),
      headers,
    )
  }
}

export function createCloseScheduleRouteHandler(dependencies: LessonAuthoringRouteDependencies) {
  return async function POST(request: Request, context: ScheduleContext) {
    const parsed = await parseMutation(request, scheduleCloseSchema)
    if (parsed.status === "failure") return parsed.response
    const routeIds = await readScheduleIds(context)
    if (!routeIds) return validationError()
    if (!dependencies.isSupabaseConfigured()) return notConfigured()
    const headers = new Headers()
    const workflowDependencies = await dependencies.createWorkflowDependencies(headers)
    return workflowResponse(
      await runCloseLessonSchedule(
        routeIds.lessonId,
        routeIds.scheduleId,
        parsed.value,
        workflowDependencies,
      ),
      headers,
    )
  }
}

async function parseMutation<T>(request: Request, schema: z.ZodType<T>) {
  if (!hasSameOrigin(request)) {
    return {
      response: boundaryError("FORBIDDEN", "Same-origin required.", 403),
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
  return parsed.status === "success"
    ? { status: "success" as const, value: parsed.value }
    : { response: validationError(), status: "failure" as const }
}

async function readLessonId(context: LessonContext) {
  const parsed = idSchema.safeParse((await context.params).lessonId)
  return parsed.success ? parsed.data : null
}

async function readScheduleIds(context: ScheduleContext) {
  const params = await context.params
  const lessonId = idSchema.safeParse(params.lessonId)
  const scheduleId = idSchema.safeParse(params.scheduleId)
  return lessonId.success && scheduleId.success
    ? { lessonId: lessonId.data, scheduleId: scheduleId.data }
    : null
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
  return boundaryError("VALIDATION_ERROR", "Invalid lesson authoring request.", 422)
}

function notConfigured() {
  return boundaryError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
}
