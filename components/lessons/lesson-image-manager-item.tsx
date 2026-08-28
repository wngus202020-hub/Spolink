import { ArrowDown, ArrowUp, RotateCcw, Star, Trash2, Upload } from "lucide-react"
import Image from "next/image"
import type { ReactNode } from "react"

import type {
  LessonImageManagerExistingImage,
  LessonImageManagerItem,
  LessonImageManagerQueuedImage,
} from "./lesson-image-manager-model"

type LessonImageManagerItemCardProps = Readonly<{
  disabled: boolean
  index: number
  item: LessonImageManagerItem
  itemCount: number
  itemRef: (element: HTMLElement | null) => void
  onDeleteExistingImage: (image: LessonImageManagerExistingImage) => void
  onMove: (itemId: string, destinationIndex: number) => void
  onRemoveQueuedImage: (image: LessonImageManagerQueuedImage) => void
  onRetryQueuedImage: (image: LessonImageManagerQueuedImage) => void
  onUploadQueuedImage: (image: LessonImageManagerQueuedImage) => void
  previewUrl: string | null
}>

export function LessonImageManagerItemCard({
  disabled,
  index,
  item,
  itemCount,
  itemRef,
  onDeleteExistingImage,
  onMove,
  onRemoveQueuedImage,
  onRetryQueuedImage,
  onUploadQueuedImage,
  previewUrl,
}: LessonImageManagerItemCardProps) {
  return (
    <article
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-[var(--radius-md)] border border-line bg-canvas p-3"
      data-lesson-image-id={item.id}
      ref={itemRef}
      tabIndex={-1}
    >
      <div className="grid min-w-0 gap-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-sm)] bg-inset">
          {previewUrl ? (
            <Image
              alt={`레슨 이미지 ${index + 1}`}
              className="object-cover"
              fill
              sizes="(min-width: 640px) 50vw, 100vw"
              src={previewUrl}
              unoptimized
            />
          ) : (
            <span className="flex size-full items-center justify-center text-sm text-secondary">
              미리보기 준비 중
            </span>
          )}
        </div>
        <div className="grid gap-1">
          <p className="m-0 text-sm font-bold text-primary">{fileNameFor(item)}</p>
          {index === 0 ? <p className="m-0 text-sm font-bold text-accent">대표 이미지</p> : null}
          <p aria-live="polite" className="m-0 text-sm text-secondary" role="status">
            {statusLabel(item)}
          </p>
        </div>
      </div>
      {!disabled ? (
        <div className="flex shrink-0 flex-col gap-1">
          {index > 0 ? (
            <IconButton label="이미지 순서 앞당기기" onClick={() => onMove(item.id, index - 1)}>
              <ArrowUp aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
          {index < itemCount - 1 ? (
            <IconButton label="이미지 순서 뒤로 미루기" onClick={() => onMove(item.id, index + 1)}>
              <ArrowDown aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
          {index > 0 ? (
            <IconButton label="대표 이미지로 설정" onClick={() => onMove(item.id, 0)}>
              <Star aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
          {item.kind === "queued" && item.status === "queued" ? (
            <IconButton label="이미지 업로드" onClick={() => onUploadQueuedImage(item)}>
              <Upload aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
          {item.kind === "queued" && item.status === "failed" ? (
            <IconButton label="업로드 다시 시도" onClick={() => onRetryQueuedImage(item)}>
              <RotateCcw aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
          {item.kind === "queued" ? (
            <IconButton label="선택한 이미지 제거" onClick={() => onRemoveQueuedImage(item)}>
              <Trash2 aria-hidden="true" className="size-5" />
            </IconButton>
          ) : item.status === "registered" ? (
            <IconButton label="이미지 삭제" onClick={() => onDeleteExistingImage(item)}>
              <Trash2 aria-hidden="true" className="size-5" />
            </IconButton>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function IconButton({
  children,
  label,
  onClick,
}: Readonly<{
  children: ReactNode
  label: string
  onClick: () => void
}>) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-line bg-canvas text-primary hover:bg-inset"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}

function fileNameFor(item: LessonImageManagerItem) {
  return item.kind === "queued" ? item.file.name : "등록된 이미지"
}

function statusLabel(item: LessonImageManagerItem) {
  if (item.kind === "existing") return item.status === "deleting" ? "삭제 중" : "등록됨"
  if (item.status === "uploading") return "업로드 중"
  if (item.status === "failed") return "업로드 실패"
  return "업로드 대기"
}
