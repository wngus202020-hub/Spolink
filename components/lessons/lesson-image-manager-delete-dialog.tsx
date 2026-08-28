import type { RefObject } from "react"

type LessonImageManagerDeleteDialogProps = Readonly<{
  deleting: boolean
  dialogRef: RefObject<HTMLDialogElement | null>
  headingId: string
  onClose: () => void
  onConfirm: () => void
}>

export function LessonImageManagerDeleteDialog({
  deleting,
  dialogRef,
  headingId,
  onClose,
  onConfirm,
}: LessonImageManagerDeleteDialogProps) {
  return (
    <dialog
      aria-labelledby={`${headingId}-delete-title`}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-xl)] border border-line bg-canvas p-5 text-primary shadow-[var(--shadow-panel)] backdrop:bg-[var(--overlay-scrim)]"
      onClose={onClose}
      ref={dialogRef}
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <h3 className="m-0 text-base font-bold text-primary" id={`${headingId}-delete-title`}>
            이미지를 삭제할까요?
          </h3>
          <p className="m-0 text-sm text-secondary">삭제하면 되돌릴 수 없습니다.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-11 rounded-[var(--radius-md)] border border-line px-4 text-sm font-bold text-primary"
            onClick={() => dialogRef.current?.close("cancel")}
            type="button"
          >
            취소
          </button>
          <button
            className="min-h-11 rounded-[var(--radius-md)] bg-accent px-4 text-sm font-bold text-[var(--text-on-accent)]"
            disabled={deleting}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            type="button"
          >
            삭제
          </button>
        </div>
      </div>
    </dialog>
  )
}
