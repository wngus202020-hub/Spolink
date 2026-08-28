import type {
  LessonImageDeleteRequest,
  LessonImageErrorResult,
  LessonImageOrderRequest,
  LessonImageRegistrationRequest,
  LessonImageUploadIntentRequest,
} from "./lesson-image-contract"

export type ReadyLessonImage = Readonly<{
  id: string
  objectName: string
  sortOrder: number
}>

export type LessonImageListData = Readonly<{ images: readonly ReadyLessonImage[] }>

export type LessonImageUploadIntentData = Readonly<{
  expiresAt: string
  expiresIn: 7200
  intentId: string
  objectName: string
  token: string
  uploadUrl: string
}>

export type LessonImageActor = "authenticated" | "unauthenticated" | "unavailable"

export type LessonImageOperationResult<T> = T | LessonImageErrorResult

export type LessonImageWorkflowDependencies = Readonly<{
  authenticate: () => Promise<LessonImageActor>
  runCleanup: () => Promise<void>
  deleteImage: (
    input: LessonImageDeleteRequest & Readonly<{ imageId: string; lessonId: string }>,
  ) => Promise<LessonImageOperationResult<readonly ReadyLessonImage[]>>
  issueUploadIntent: (
    input: LessonImageUploadIntentRequest & Readonly<{ lessonId: string }>,
  ) => Promise<LessonImageOperationResult<LessonImageUploadIntentData>>
  registerImage: (
    input: LessonImageRegistrationRequest & Readonly<{ lessonId: string }>,
  ) => Promise<LessonImageOperationResult<readonly ReadyLessonImage[]>>
  reorderImages: (
    input: LessonImageOrderRequest & Readonly<{ lessonId: string }>,
  ) => Promise<LessonImageOperationResult<readonly ReadyLessonImage[]>>
}>
