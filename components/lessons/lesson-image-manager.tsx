"use client"

import { ImagePlus } from "lucide-react"
import { type ChangeEvent, useEffect, useId, useRef, useState } from "react"

import { LessonImageManagerDeleteDialog } from "./lesson-image-manager-delete-dialog"
import { LessonImageManagerItemCard } from "./lesson-image-manager-item"
import type {
  LessonImageManagerDeleteResult,
  LessonImageManagerExistingImage,
  LessonImageManagerItem,
  LessonImageManagerItemReference,
  LessonImageManagerQueuedImage,
} from "./lesson-image-manager-model"
import {
  LessonImagePreviewRegistry,
  moveLessonImageManagerItem,
  queuedItems,
  toItemReference,
  validateLessonImageSelection,
} from "./lesson-image-manager-model"

export type {
  LessonImageManagerDeleteResult,
  LessonImageManagerExistingImage,
  LessonImageManagerItem,
  LessonImageManagerItemReference,
  LessonImageManagerQueuedImage,
  LessonImageSelectionResult,
} from "./lesson-image-manager-model"
export {
  LESSON_IMAGE_MANAGER_MAX_BYTES,
  LessonImagePreviewRegistry,
  moveLessonImageManagerItem,
  validateLessonImageSelection,
} from "./lesson-image-manager-model"

type LessonImageManagerProps = Readonly<{
  disabled?: boolean
  items: readonly LessonImageManagerItem[]
  onDeleteExistingImage: (
    image: LessonImageManagerExistingImage,
  ) => LessonImageManagerDeleteResult | Promise<LessonImageManagerDeleteResult>
  onQueueFiles: (files: readonly File[]) => void
  onRemoveQueuedImage: (image: LessonImageManagerQueuedImage) => void
  onReorderItems: (items: readonly LessonImageManagerItemReference[]) => void
  onRetryQueuedImage: (image: LessonImageManagerQueuedImage) => void
  onUploadQueuedImage: (image: LessonImageManagerQueuedImage) => void
}>

export function LessonImageManager({
  disabled = false,
  items,
  onDeleteExistingImage,
  onQueueFiles,
  onRemoveQueuedImage,
  onReorderItems,
  onRetryQueuedImage,
  onUploadQueuedImage,
}: LessonImageManagerProps) {
  const headingId = useId()
  const addInputRef = useRef<HTMLInputElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const focusRestoreRef = useRef<HTMLElement | null>(null)
  const previewRegistryRef = useRef<LessonImagePreviewRegistry | null>(null)
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const queuedError = items.find(
    (item): item is LessonImageManagerQueuedImage =>
      item.kind === "queued" && item.status === "failed" && Boolean(item.errorMessage),
  )?.errorMessage
  const errorMessage = selectionError ?? actionError ?? queuedError ?? null

  useEffect(() => {
    previewRegistryRef.current ??= new LessonImagePreviewRegistry(URL)
    setPreviews(previewRegistryRef.current.reconcile(queuedItems(items)))
  }, [items])

  useEffect(
    () => () => {
      previewRegistryRef.current?.dispose()
    },
    [],
  )

  useEffect(() => {
    if (errorMessage) alertRef.current?.focus()
  }, [errorMessage])

  function showDeleteError(message: string) {
    setDeletingId(null)
    setPendingDeleteId(null)
    deleteDialogRef.current?.close("error")
    setActionError(message)
  }

  function updateOrder(itemId: string, destinationIndex: number) {
    const orderedItems = moveLessonImageManagerItem(items, itemId, destinationIndex)
    onReorderItems(orderedItems.map(toItemReference))
  }

  function queueSelectedFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    const selection = validateLessonImageSelection({ currentItemCount: items.length, files })
    if (selection.status === "error") {
      setSelectionError(selection.message)
      return
    }
    setSelectionError(null)
    onQueueFiles(files)
  }

  function openDeleteDialog(image: LessonImageManagerExistingImage) {
    setActionError(null)
    const index = items.findIndex((item) => item.id === image.id)
    const neighbor = items[index + 1] ?? items[index - 1]
    focusRestoreRef.current = neighbor ? (itemRefs.current.get(neighbor.id) ?? null) : null
    setPendingDeleteId(image.id)
    deleteDialogRef.current?.showModal()
  }

  async function confirmDelete() {
    const image = items.find(
      (item): item is LessonImageManagerExistingImage =>
        item.kind === "existing" && item.id === pendingDeleteId,
    )
    if (!image) return
    setDeletingId(image.id)
    let result: LessonImageManagerDeleteResult
    try {
      result = await onDeleteExistingImage(image)
    } catch {
      showDeleteError("이미지를 삭제하지 못했습니다. 다시 시도해 주세요.")
      return
    }
    setDeletingId(null)
    if (result.status === "error") {
      showDeleteError(result.message)
      return
    }
    setPendingDeleteId(null)
    deleteDialogRef.current?.close("confirmed")
    window.setTimeout(() => {
      const target = focusRestoreRef.current
      if (target?.isConnected) target.focus()
      else addInputRef.current?.focus()
      focusRestoreRef.current = null
    }, 50)
  }

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-4">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-primary" id={headingId}>
          레슨 이미지
        </h2>
        <p className="m-0 text-sm text-secondary">JPEG · PNG · WebP, 최대 5장</p>
      </div>

      {disabled ? <p className="m-0 text-sm text-secondary">읽기 전용</p> : null}
      {errorMessage ? (
        <p
          aria-live="assertive"
          className="m-0 rounded-[var(--radius-md)] border border-status-error bg-inset px-3 py-2 text-sm text-primary focus:outline-2 focus:outline-offset-2 focus:outline-primary"
          id={`${headingId}-error`}
          ref={alertRef}
          role="alert"
          tabIndex={-1}
        >
          {errorMessage}
        </p>
      ) : null}

      <ol className="m-0 grid min-w-0 list-none gap-3 p-0 sm:grid-cols-2">
        {items.map((item, index) => (
          <li className="min-w-0" key={`${item.kind}:${item.id}`}>
            <LessonImageManagerItemCard
              disabled={disabled || deletingId === item.id}
              index={index}
              item={item}
              itemCount={items.length}
              itemRef={(element) => {
                if (element) itemRefs.current.set(item.id, element)
                else itemRefs.current.delete(item.id)
              }}
              onDeleteExistingImage={openDeleteDialog}
              onMove={updateOrder}
              onRemoveQueuedImage={(queuedImage) => {
                previewRegistryRef.current?.release(queuedImage.id)
                setPreviews((current) => withoutPreview(current, queuedImage.id))
                onRemoveQueuedImage(queuedImage)
              }}
              onRetryQueuedImage={onRetryQueuedImage}
              onUploadQueuedImage={onUploadQueuedImage}
              previewUrl={
                item.kind === "existing" ? item.previewUrl : (previews.get(item.id) ?? null)
              }
            />
          </li>
        ))}
      </ol>

      {!disabled ? (
        <label className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset">
          <ImagePlus aria-hidden="true" className="size-5" />
          이미지 추가
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="레슨 이미지 추가"
            className="sr-only"
            multiple
            onChange={queueSelectedFiles}
            ref={addInputRef}
            type="file"
          />
        </label>
      ) : (
        <input
          aria-label="레슨 이미지 추가"
          className="sr-only"
          disabled
          ref={addInputRef}
          type="file"
        />
      )}

      {!disabled ? (
        <LessonImageManagerDeleteDialog
          deleting={deletingId !== null}
          dialogRef={deleteDialogRef}
          headingId={headingId}
          onClose={() => setPendingDeleteId(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  )
}

function withoutPreview(previews: ReadonlyMap<string, string>, id: string) {
  const next = new Map(previews)
  next.delete(id)
  return next
}
