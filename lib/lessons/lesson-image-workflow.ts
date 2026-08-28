import type {
  LessonImageDeleteRequest,
  LessonImageErrorCode,
  LessonImageErrorResult,
  LessonImageOrderRequest,
  LessonImageRegistrationRequest,
  LessonImageResult,
  LessonImageUploadIntentRequest,
} from "./lesson-image-contract"
import { LESSON_IMAGE_ERROR_STATUS_BY_CODE } from "./lesson-image-contract"
import type {
  LessonImageListData,
  LessonImageUploadIntentData,
  LessonImageWorkflowDependencies,
} from "./lesson-image-types"

export async function runIssueLessonImageUploadIntent(
  lessonId: string,
  input: LessonImageUploadIntentRequest,
  dependencies: LessonImageWorkflowDependencies,
): Promise<LessonImageResult<LessonImageUploadIntentData>> {
  return runAuthenticated(dependencies, () =>
    dependencies.issueUploadIntent({ ...input, lessonId }),
  )
}

export async function runRegisterLessonImage(
  lessonId: string,
  input: LessonImageRegistrationRequest,
  dependencies: LessonImageWorkflowDependencies,
): Promise<LessonImageResult<LessonImageListData>> {
  return runAuthenticated(dependencies, async () => {
    const result = await dependencies.registerImage({ ...input, lessonId })
    return isError(result) ? result : { images: result }
  })
}

export async function runReorderLessonImages(
  lessonId: string,
  input: LessonImageOrderRequest,
  dependencies: LessonImageWorkflowDependencies,
): Promise<LessonImageResult<LessonImageListData>> {
  return runAuthenticated(dependencies, async () => {
    const result = await dependencies.reorderImages({ ...input, lessonId })
    return isError(result) ? result : { images: result }
  })
}

export async function runDeleteLessonImage(
  lessonId: string,
  imageId: string,
  input: LessonImageDeleteRequest,
  dependencies: LessonImageWorkflowDependencies,
): Promise<LessonImageResult<LessonImageListData>> {
  return runAuthenticated(dependencies, async () => {
    const result = await dependencies.deleteImage({ ...input, imageId, lessonId })
    return isError(result) ? result : { images: result }
  })
}

async function runAuthenticated<T>(
  dependencies: LessonImageWorkflowDependencies,
  operation: () => Promise<T | LessonImageErrorResult>,
): Promise<LessonImageResult<T>> {
  try {
    const actor = await dependencies.authenticate()
    if (actor === "unauthenticated") {
      return failure("UNAUTHENTICATED")
    }
    if (actor === "unavailable") return failure("UNAVAILABLE")
    await dependencies.runCleanup()
    const result = await operation()
    return isError(result) ? result : { data: result, status: "success" }
  } catch {
    return failure("UNAVAILABLE")
  }
}

function isError(value: unknown): value is LessonImageErrorResult {
  return (
    typeof value === "object" && value !== null && "status" in value && value.status === "error"
  )
}

export function lessonImageFailure(code: LessonImageErrorCode): LessonImageErrorResult {
  return failure(code)
}

function failure(code: LessonImageErrorCode): LessonImageErrorResult {
  return { code, status: "error", statusCode: LESSON_IMAGE_ERROR_STATUS_BY_CODE[code] }
}
