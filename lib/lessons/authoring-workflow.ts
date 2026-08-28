import type { WorkflowFailure, WorkflowResult } from "../profile/types"
import type {
  LessonDraftInput,
  LessonTransitionInput,
  LessonUpdateInput,
  ScheduleCloseInput,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from "./authoring-contract"
import type {
  AuthoringAccess,
  LessonAuthoringData,
  LessonAuthoringDependencies,
  LessonRow,
  RepositoryResult,
  ScheduleAuthoringData,
  ScheduleRow,
} from "./authoring-types"

export async function runCreateLessonDraft(
  input: LessonDraftInput,
  dependencies: Pick<LessonAuthoringDependencies, "createLesson" | "getActorAccess">,
): Promise<WorkflowResult<Readonly<{ data: LessonAuthoringData }>>> {
  const access = requireCoach(await dependencies.getActorAccess())
  if (access) return access
  return mapLessonResult(await dependencies.createLesson(input), 201)
}

export async function runUpdateLessonDraft(
  lessonId: string,
  input: LessonUpdateInput,
  dependencies: Pick<LessonAuthoringDependencies, "getActorAccess" | "updateLesson">,
) {
  const access = requireCoach(await dependencies.getActorAccess())
  if (access) return access
  return mapLessonResult(await dependencies.updateLesson(lessonId, input), 200)
}

export async function runTransitionLesson(
  lessonId: string,
  input: LessonTransitionInput,
  dependencies: Pick<LessonAuthoringDependencies, "getActorAccess" | "transitionLesson">,
) {
  const actor = await dependencies.getActorAccess()
  const access =
    input.action === "approve" || input.action === "reject"
      ? requireAdmin(actor)
      : requireCoach(actor)
  if (access) return access
  return mapLessonResult(await dependencies.transitionLesson(lessonId, input), 200)
}

export async function runCreateLessonSchedule(
  lessonId: string,
  input: ScheduleCreateInput,
  dependencies: Pick<LessonAuthoringDependencies, "createSchedule" | "getActorAccess">,
) {
  const access = requireCoach(await dependencies.getActorAccess())
  if (access) return access
  return mapScheduleResult(await dependencies.createSchedule(lessonId, input), 201)
}

export async function runUpdateLessonSchedule(
  lessonId: string,
  scheduleId: string,
  input: ScheduleUpdateInput,
  dependencies: Pick<LessonAuthoringDependencies, "getActorAccess" | "updateSchedule">,
) {
  const access = requireCoach(await dependencies.getActorAccess())
  if (access) return access
  return mapScheduleResult(await dependencies.updateSchedule(lessonId, scheduleId, input), 200)
}

export async function runCloseLessonSchedule(
  lessonId: string,
  scheduleId: string,
  input: ScheduleCloseInput,
  dependencies: Pick<LessonAuthoringDependencies, "closeSchedule" | "getActorAccess">,
) {
  const access = requireCoach(await dependencies.getActorAccess())
  if (access) return access
  return mapScheduleResult(await dependencies.closeSchedule(lessonId, scheduleId, input), 200)
}

function requireCoach(access: AuthoringAccess): WorkflowFailure | null {
  switch (access.kind) {
    case "approved_coach":
      return null
    case "unauthenticated":
      return failure("UNAUTHORIZED", "Authentication required.", 401)
    case "pending_coach":
      return failure("COACH_NOT_APPROVED", "Approved active coach required.", 403)
    case "admin":
    case "forbidden":
      return failure("FORBIDDEN", "Coach access is required.", 403)
    default:
      return access satisfies never
  }
}

function requireAdmin(access: AuthoringAccess): WorkflowFailure | null {
  switch (access.kind) {
    case "admin":
      return null
    case "unauthenticated":
      return failure("UNAUTHORIZED", "Authentication required.", 401)
    case "approved_coach":
    case "pending_coach":
    case "forbidden":
      return failure("FORBIDDEN", "Administrator access is required.", 403)
    default:
      return access satisfies never
  }
}

function mapLessonResult(
  result: RepositoryResult<LessonRow>,
  statusCode: number,
): WorkflowResult<Readonly<{ data: LessonAuthoringData }>> {
  if (result.errorCode || !result.data) return repositoryFailure(result.errorCode)
  return {
    response: {
      data: {
        id: result.data.id,
        status: result.data.status,
        title: result.data.title,
        updatedAt: result.data.updated_at,
      },
    },
    status: "success",
    statusCode,
  }
}

function mapScheduleResult(
  result: RepositoryResult<ScheduleRow>,
  statusCode: number,
): WorkflowResult<Readonly<{ data: ScheduleAuthoringData }>> {
  if (result.errorCode || !result.data) return repositoryFailure(result.errorCode)
  return {
    response: {
      data: {
        capacity: result.data.capacity,
        endsAt: result.data.ends_at,
        id: result.data.id,
        isOpen: result.data.is_open,
        lessonId: result.data.lesson_id,
        reservedCount: result.data.reserved_count,
        startsAt: result.data.starts_at,
        updatedAt: result.data.updated_at,
      },
    },
    status: "success",
    statusCode,
  }
}

function repositoryFailure(code: string | null): WorkflowFailure {
  switch (code) {
    case "UNAUTHORIZED":
      return failure(code, "Authentication required.", 401)
    case "COACH_NOT_APPROVED":
    case "FORBIDDEN":
      return failure(code, "This lesson action is not allowed.", 403)
    case "LESSON_NOT_FOUND":
    case "SCHEDULE_NOT_FOUND":
      return failure(code, "Lesson or schedule was not found.", 404)
    case "LESSON_STATE_CONFLICT":
    case "IMAGE_OPERATION_PENDING":
    case "SCHEDULE_HAS_CONFIRMED_RESERVATION":
    case "STALE_LESSON":
    case "STALE_SCHEDULE":
      return failure(code, "Lesson or schedule state has changed.", 409)
    case "23P01":
      return failure(
        "SCHEDULE_OVERLAP_CONFLICT",
        "The lesson schedule overlaps an existing schedule.",
        409,
      )
    case "VALIDATION_ERROR":
      return failure(code, "Lesson authoring input is invalid.", 422)
    default:
      return failure("INTERNAL_ERROR", "Unable to complete lesson authoring request.", 500)
  }
}

function failure(code: string, message: string, statusCode: number): WorkflowFailure {
  return { error: { code, message, statusCode }, status: "failure" }
}
