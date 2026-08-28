import ky, { HTTPError } from "ky"

import type {
  LessonDraftInput,
  LessonTransitionInput,
  LessonUpdateInput,
  ScheduleCloseInput,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from "./authoring-contract"
import type { LessonAuthoringData, ScheduleAuthoringData } from "./authoring-types"

type MutationResult<T> =
  | { readonly data: T; readonly status: "success" }
  | { readonly message: string; readonly status: "failure"; readonly statusCode: number }

export function createLessonDraft(input: LessonDraftInput) {
  return mutate<LessonAuthoringData>("/api/lessons", "post", input)
}

export function updateLessonDraft(lessonId: string, input: LessonUpdateInput) {
  return mutate<LessonAuthoringData>(`/api/lessons/${lessonId}`, "patch", input)
}

export function transitionLesson(lessonId: string, input: LessonTransitionInput) {
  return mutate<LessonAuthoringData>(`/api/lessons/${lessonId}/status`, "post", input)
}

export function createLessonSchedule(lessonId: string, input: ScheduleCreateInput) {
  return mutate<ScheduleAuthoringData>(`/api/lessons/${lessonId}/schedules`, "post", input)
}

export function updateLessonSchedule(
  lessonId: string,
  scheduleId: string,
  input: ScheduleUpdateInput,
) {
  return mutate<ScheduleAuthoringData>(
    `/api/lessons/${lessonId}/schedules/${scheduleId}`,
    "patch",
    input,
  )
}

export function closeLessonSchedule(
  lessonId: string,
  scheduleId: string,
  input: ScheduleCloseInput,
) {
  return mutate<ScheduleAuthoringData>(
    `/api/lessons/${lessonId}/schedules/${scheduleId}/close`,
    "post",
    input,
  )
}

async function mutate<T>(
  path: string,
  method: "patch" | "post",
  input: object,
): Promise<MutationResult<T>> {
  try {
    const response = await ky(path, {
      credentials: "same-origin",
      json: input,
      method,
      retry: 0,
      timeout: 15_000,
    }).json<Readonly<{ data: T }>>()
    return { data: response.data, status: "success" }
  } catch (error) {
    if (error instanceof HTTPError) {
      const body: unknown = await error.response.json()
      return {
        message: readErrorMessage(body),
        status: "failure",
        statusCode: error.response.status,
      }
    }
    if (error instanceof Error) {
      return { message: "요청을 완료하지 못했습니다.", status: "failure", statusCode: 503 }
    }
    throw error
  }
}

function readErrorMessage(value: unknown) {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return "요청을 완료하지 못했습니다."
  }
  const error = value.error
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return "요청을 완료하지 못했습니다."
  }
  return typeof error.message === "string" ? error.message : "요청을 완료하지 못했습니다."
}
