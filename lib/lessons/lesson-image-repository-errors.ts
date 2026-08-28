import { LessonImageStorageError } from "../storage/lesson-images"
import type { LessonImageErrorCode } from "./lesson-image-contract"
import type { LessonImageOperationResult } from "./lesson-image-types"
import { lessonImageFailure } from "./lesson-image-workflow"

export async function captureLessonImageRepositoryResult<T>(
  operation: () => Promise<T>,
): Promise<LessonImageOperationResult<T>> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof LessonImageRepositoryError) return lessonImageFailure(error.code)
    if (error instanceof LessonImageStorageError) {
      return lessonImageFailure(mapStorageError(error))
    }
    return lessonImageFailure("UNAVAILABLE")
  }
}

export function mapLessonImageRpcError(
  error: Readonly<{ code: string; message: string }>,
): LessonImageErrorCode {
  if (error.code !== "P0001") return "UNAVAILABLE"
  if (
    [
      "COACH_NOT_APPROVED",
      "FORBIDDEN",
      "LESSON_NOT_FOUND",
      "LESSON_STATE_CONFLICT",
      "UNAUTHORIZED",
    ].includes(error.message)
  )
    return "FORBIDDEN"
  if (
    ["IMAGE_INTENT_NOT_FOUND", "IMAGE_OBJECT_NOT_FOUND", "LESSON_IMAGE_NOT_FOUND"].includes(
      error.message,
    )
  )
    return "NOT_FOUND"
  if (
    [
      "IMAGE_INTENT_NOT_ACTIVE",
      "IMAGE_OPERATION_PENDING",
      "LESSON_IMAGE_LIMIT",
      "LESSON_IMAGE_NOT_DELETING",
      "STALE_LESSON_IMAGES",
    ].includes(error.message)
  )
    return "CONFLICT"
  if (
    ["IMAGE_OBJECT_INVALID", "UNSUPPORTED_IMAGE_TYPE", "VALIDATION_ERROR"].includes(error.message)
  )
    return "VALIDATION_ERROR"
  return "UNAVAILABLE"
}

function mapStorageError(error: LessonImageStorageError): LessonImageErrorCode {
  if (error.code === "intent_not_found" || error.code === "object_not_found") return "NOT_FOUND"
  if (error.code === "invalid_blob" || error.code === "invalid_input") return "VALIDATION_ERROR"
  return "UNAVAILABLE"
}

export class LessonImageRepositoryError extends Error {
  readonly code: LessonImageErrorCode

  constructor(code: LessonImageErrorCode) {
    super("Lesson image repository operation failed.")
    this.code = code
  }
}
