import type { LessonImageErrorResult } from "@/lib/lessons/lesson-image-contract"
import type {
  LessonImageListData,
  LessonImageUploadIntentData,
  ReadyLessonImage,
} from "@/lib/lessons/lesson-image-types"
import type {
  LessonImageManagerExistingImage,
  LessonImageManagerItem,
  LessonImageManagerQueuedImage,
} from "./lesson-image-manager-model"

type Success<T> = Readonly<{ data: T; status: "success" }>
type UploadSuccess = Readonly<{ status: "success" }>
type ImageResult<T> = Success<T> | LessonImageErrorResult

export type LessonImageAuthoringExistingImage = LessonImageManagerExistingImage &
  Readonly<{ objectName: string }>

export type LessonImageAuthoringQueuedImage = LessonImageManagerQueuedImage &
  Readonly<{
    uploadIntent?: LessonImageUploadIntentData | undefined
    uploadStage?: "intent" | "register" | "restart" | "upload" | undefined
  }>

export type LessonImageAuthoringItem =
  | LessonImageAuthoringExistingImage
  | LessonImageAuthoringQueuedImage

export type LessonImageUploadDependencies = Readonly<{
  imageUrl: (objectName: string) => string
  issueIntent: (lessonId: string, file: File) => Promise<ImageResult<LessonImageUploadIntentData>>
  register: (
    lessonId: string,
    intent: LessonImageUploadIntentData,
  ) => Promise<ImageResult<LessonImageListData>>
  reorder: (
    lessonId: string,
    expectedImageIds: readonly string[],
    orderedImageIds: readonly string[],
  ) => Promise<ImageResult<LessonImageListData>>
  upload: (
    intent: LessonImageUploadIntentData,
    file: File,
  ) => Promise<UploadSuccess | LessonImageErrorResult>
}>

export type LessonImageUploadRunResult =
  | Readonly<{ items: readonly LessonImageAuthoringItem[]; status: "success" }>
  | Readonly<{
      error: LessonImageErrorResult
      items: readonly LessonImageAuthoringItem[]
      status: "error"
    }>

type UploadPendingLessonImagesInput = Readonly<{
  dependencies: LessonImageUploadDependencies
  items: readonly LessonImageAuthoringItem[]
  lessonId: string
  onActiveIntentChange?: ((active: boolean) => void) | undefined
  onItemsChange: (items: readonly LessonImageAuthoringItem[]) => void
  targetIds?: readonly string[] | undefined
}>

export async function uploadPendingLessonImages({
  dependencies,
  items,
  lessonId,
  onActiveIntentChange,
  onItemsChange,
  targetIds,
}: UploadPendingLessonImagesInput): Promise<LessonImageUploadRunResult> {
  let current = [...items]
  let latestServerImages: readonly ReadyLessonImage[] | null = null

  for (const originalItem of items) {
    if (originalItem.kind === "existing") continue
    if (targetIds && !targetIds.includes(originalItem.id)) continue
    const currentItem = findQueuedItem(current, originalItem.id)
    if (!currentItem) continue

    const uploading = { ...currentItem, errorMessage: undefined, status: "uploading" } as const
    current = replaceItem(current, uploading.id, uploading)
    onItemsChange(current)

    let intent = uploading.uploadIntent
    if (
      !intent ||
      uploading.uploadStage === "intent" ||
      uploading.uploadStage === "restart" ||
      !uploading.uploadStage
    ) {
      const intentResult = await dependencies.issueIntent(lessonId, uploading.file)
      if (intentResult.status === "error") {
        return failItem(current, uploading, intentResult, "intent", onItemsChange)
      }
      intent = intentResult.data
      current = replaceItem(current, uploading.id, {
        ...uploading,
        uploadIntent: intent,
        uploadStage: "upload",
      })
      onActiveIntentChange?.(true)
      onItemsChange(current)
    } else {
      onActiveIntentChange?.(true)
    }

    if (uploading.uploadStage !== "register") {
      const uploadResult = await dependencies.upload(intent, uploading.file)
      if (uploadResult.status === "error") {
        return failItem(current, uploading, uploadResult, "upload", onItemsChange, intent)
      }
      current = replaceItem(current, uploading.id, {
        ...uploading,
        uploadIntent: intent,
        uploadStage: "register",
      })
      onItemsChange(current)
    }

    const registerResult = await dependencies.register(lessonId, intent)
    if (registerResult.status === "error") {
      return failItem(current, uploading, registerResult, "restart", onItemsChange)
    }
    latestServerImages = registerResult.data.images
    const registered = latestServerImages.find((image) => image.objectName === intent.objectName)
    if (!registered) {
      return failItem(current, uploading, unavailableError, "restart", onItemsChange)
    }
    current = replaceItem(current, uploading.id, toExistingItem(registered, dependencies.imageUrl))
    onActiveIntentChange?.(false)
    onItemsChange(current)
  }

  if (latestServerImages) {
    const expectedIds = latestServerImages.map((image) => image.id)
    const orderedIds = current
      .filter((item): item is LessonImageAuthoringExistingImage => item.kind === "existing")
      .map((item) => item.id)
    if (!sameOrder(expectedIds, orderedIds)) {
      const reorderResult = await dependencies.reorder(lessonId, expectedIds, orderedIds)
      if (reorderResult.status === "error") {
        return { error: reorderResult, items: current, status: "error" }
      }
    }
  }

  return { items: current, status: "success" }
}

export function hasBlockingLessonImageWork(
  items: readonly LessonImageManagerItem[],
  activeIntent: boolean,
): boolean {
  return (
    activeIntent ||
    items.some(
      (item) =>
        (item.kind === "queued" &&
          (item.status === "queued" || item.status === "uploading" || item.status === "failed")) ||
        (item.kind === "existing" && item.status === "deleting"),
    )
  )
}

export function lessonImageActionErrorMessage(error: LessonImageErrorResult): string {
  if (error.statusCode === 409) {
    return "이미지 상태가 변경되었습니다. 이 페이지를 새로 열어 다시 시도해 주세요."
  }
  if (error.statusCode === 415 || error.statusCode === 422) {
    return "이미지 파일을 확인하고 다시 시도해 주세요."
  }
  return "이미지를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
}

function failItem(
  items: readonly LessonImageAuthoringItem[],
  item: LessonImageAuthoringQueuedImage,
  error: LessonImageErrorResult,
  uploadStage: "intent" | "register" | "restart" | "upload",
  onItemsChange: (items: readonly LessonImageAuthoringItem[]) => void,
  uploadIntent?: LessonImageUploadIntentData,
): LessonImageUploadRunResult {
  const failed = replaceItem(items, item.id, {
    ...item,
    errorMessage:
      uploadStage === "restart"
        ? `${lessonImageActionErrorMessage(error)} 다시 시도하면 새 업로드로 시작합니다.`
        : lessonImageActionErrorMessage(error),
    status: "failed",
    uploadIntent,
    uploadStage,
  })
  onItemsChange(failed)
  return { error, items: failed, status: "error" }
}

function findQueuedItem(items: readonly LessonImageAuthoringItem[], id: string) {
  return items.find(
    (item): item is LessonImageAuthoringQueuedImage => item.kind === "queued" && item.id === id,
  )
}

function replaceItem(
  items: readonly LessonImageAuthoringItem[],
  replacedId: string,
  replacement: LessonImageAuthoringItem,
) {
  return items.map((item) => (item.id === replacedId ? replacement : item))
}

function sameOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function toExistingItem(
  image: ReadyLessonImage,
  imageUrl: (objectName: string) => string,
): LessonImageAuthoringExistingImage {
  return {
    id: image.id,
    kind: "existing",
    objectName: image.objectName,
    previewUrl: imageUrl(image.objectName),
    status: "registered",
  }
}

const unavailableError = {
  code: "UNAVAILABLE",
  status: "error",
  statusCode: 503,
} as const satisfies LessonImageErrorResult
