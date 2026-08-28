"use client"

import { useRef, useState } from "react"

import {
  deleteLessonImage,
  issueLessonImageUploadIntent,
  registerLessonImage,
  reorderLessonImages,
  uploadLessonImageToSignedUrl,
} from "@/lib/lessons/lesson-image-client"
import { lessonImageMimeTypeSchema } from "@/lib/lessons/lesson-image-contract"
import { getSupabasePublicStorageUrl } from "@/lib/supabase/public-read-client"
import {
  hasBlockingLessonImageWork,
  type LessonImageAuthoringExistingImage,
  type LessonImageAuthoringItem,
  type LessonImageAuthoringQueuedImage,
  type LessonImageUploadDependencies,
  lessonImageActionErrorMessage,
  uploadPendingLessonImages,
} from "./coach-lesson-image-authoring-model"
import type {
  LessonImageManagerDeleteResult,
  LessonImageManagerExistingImage,
  LessonImageManagerItemReference,
} from "./lesson-image-manager"

export type CoachLessonInitialImage = Readonly<{
  id: string
  lifecycleState: "deleting" | "ready"
  objectName: string
  previewUrl: string
}>

type UseCoachLessonImagesInput = Readonly<{
  initialImages: readonly CoachLessonInitialImage[]
  lessonId: string | null
  mutable: boolean
}>

export function useCoachLessonImages({
  initialImages,
  lessonId,
  mutable,
}: UseCoachLessonImagesInput) {
  const initialItems = initialImages.map(toInitialItem)
  const [items, setItemsState] = useState<readonly LessonImageAuthoringItem[]>(initialItems)
  const itemsRef = useRef(items)
  const [activeIntent, setActiveIntent] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageMessage, setImageMessage] = useState<string | null>(null)

  function setItems(nextItems: readonly LessonImageAuthoringItem[]) {
    itemsRef.current = nextItems
    setItemsState(nextItems)
  }

  function queueFiles(files: readonly File[]) {
    const queued = files.map(
      (file): LessonImageAuthoringQueuedImage => ({
        file,
        id: crypto.randomUUID(),
        kind: "queued",
        status: "queued",
        uploadStage: "intent",
      }),
    )
    setItems([...itemsRef.current, ...queued])
    setImageMessage(null)
  }

  async function uploadImages(lessonIdOverride?: string, queuedItemId?: string) {
    const targetLessonId = lessonIdOverride ?? lessonId
    if (!targetLessonId || imageBusy) return false
    setImageBusy(true)
    setImageMessage(null)
    const result = await uploadPendingLessonImages({
      dependencies: imageDependencies,
      items: itemsRef.current,
      lessonId: targetLessonId,
      onActiveIntentChange: setActiveIntent,
      onItemsChange: setItems,
      targetIds: queuedItemId ? [queuedItemId] : undefined,
    })
    setImageBusy(false)
    setItems(result.items)
    if (result.status === "error") {
      setImageMessage(null)
      return false
    }
    return true
  }

  async function deleteExistingImage(
    image: LessonImageManagerExistingImage,
  ): Promise<LessonImageManagerDeleteResult> {
    if (!lessonId || imageBusy) return { message: "이미지 작업이 진행 중입니다.", status: "error" }
    const previous = itemsRef.current
    const authoringImage = previous.find(
      (item): item is LessonImageAuthoringExistingImage =>
        item.kind === "existing" && item.id === image.id,
    )
    if (!authoringImage) return { message: "이미지를 찾지 못했습니다.", status: "error" }
    setImageBusy(true)
    setItems(
      previous.map((item) =>
        item.kind === "existing" && item.id === image.id ? { ...item, status: "deleting" } : item,
      ),
    )
    const result = await deleteLessonImage(lessonId, authoringImage.id, {
      expectedImageIds: [...existingIds(previous)],
    })
    setImageBusy(false)
    if (result.status === "error") {
      setItems(previous)
      const message = lessonImageActionErrorMessage(result)
      return { message, status: "error" }
    }
    setItems(mergeServerImages(previous, result.data.images, imageDependencies.imageUrl))
    setImageMessage(null)
    return { status: "success" }
  }

  function reorderItems(references: readonly LessonImageManagerItemReference[]) {
    const previous = itemsRef.current
    const next = references
      .map((reference) => previous.find((item) => item.id === reference.id))
      .filter((item): item is LessonImageAuthoringItem => item !== undefined)
    setItems(next)
    if (!lessonId || next.some((item) => item.kind === "queued")) return
    setImageBusy(true)
    void reorderLessonImages(lessonId, {
      expectedImageIds: [...existingIds(previous)],
      orderedImageIds: [...existingIds(next)],
    }).then((result) => {
      setImageBusy(false)
      if (result.status === "error") {
        setItems(previous)
        setImageMessage(lessonImageActionErrorMessage(result))
      } else {
        setImageMessage(null)
      }
    })
  }

  return {
    blockingReview: hasBlockingLessonImageWork(items, activeIntent),
    imageBusy,
    imageMessage,
    items,
    managerProps: {
      disabled:
        !mutable ||
        imageBusy ||
        items.some((item) => item.kind === "existing" && item.status === "deleting"),
      items,
      onDeleteExistingImage: deleteExistingImage,
      onQueueFiles: queueFiles,
      onRemoveQueuedImage: (image: LessonImageAuthoringQueuedImage) => {
        if (image.uploadIntent) {
          setImageMessage("업로드가 시작된 이미지는 다시 시도해 완료해 주세요.")
          return
        }
        setItems(itemsRef.current.filter((item) => item.id !== image.id))
      },
      onReorderItems: reorderItems,
      onRetryQueuedImage: (image: LessonImageAuthoringQueuedImage) =>
        void uploadImages(undefined, image.id),
      onUploadQueuedImage: (image: LessonImageAuthoringQueuedImage) =>
        void uploadImages(undefined, image.id),
    },
    hasQueued: items.some((item) => item.kind === "queued"),
    retryable: items.some((item) => item.kind === "queued" && item.status === "failed"),
    uploadImages,
  }
}

const imageDependencies: LessonImageUploadDependencies = {
  imageUrl: (objectName) => getSupabasePublicStorageUrl(objectName) ?? objectName,
  issueIntent: (lessonId, file) => {
    const mimeType = lessonImageMimeTypeSchema.safeParse(file.type)
    if (!mimeType.success) return Promise.resolve(validationError)
    return issueLessonImageUploadIntent(lessonId, { mimeType: mimeType.data, sizeBytes: file.size })
  },
  register: (lessonId, intent) =>
    registerLessonImage(lessonId, {
      intentId: intent.intentId,
      objectName: intent.objectName,
    }),
  reorder: (lessonId, expectedImageIds, orderedImageIds) =>
    reorderLessonImages(lessonId, {
      expectedImageIds: [...expectedImageIds],
      orderedImageIds: [...orderedImageIds],
    }),
  upload: (intent, file) =>
    uploadLessonImageToSignedUrl(intent.uploadUrl, intent.token, file, { upsert: false }),
}

function existingIds(items: readonly LessonImageAuthoringItem[]) {
  return items
    .filter((item): item is LessonImageAuthoringExistingImage => item.kind === "existing")
    .map((item) => item.id)
}

function mergeServerImages(
  current: readonly LessonImageAuthoringItem[],
  serverImages: readonly Readonly<{ id: string; objectName: string }>[],
  imageUrl: (objectName: string) => string,
) {
  const byId = new Map(serverImages.map((image) => [image.id, image]))
  return current.flatMap((item): readonly LessonImageAuthoringItem[] => {
    if (item.kind === "queued") return [item]
    const serverImage = byId.get(item.id)
    return serverImage
      ? [
          {
            id: serverImage.id,
            kind: "existing",
            objectName: serverImage.objectName,
            previewUrl: imageUrl(serverImage.objectName),
            status: "registered",
          },
        ]
      : []
  })
}

function toInitialItem(image: CoachLessonInitialImage): LessonImageAuthoringExistingImage {
  return {
    id: image.id,
    kind: "existing",
    objectName: image.objectName,
    previewUrl: image.previewUrl,
    status: image.lifecycleState === "deleting" ? "deleting" : "registered",
  }
}

const validationError = {
  code: "VALIDATION_ERROR",
  status: "error",
  statusCode: 422,
} as const
