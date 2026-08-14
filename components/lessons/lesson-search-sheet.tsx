import { RotateCcw, X } from "lucide-react"
import type { ReactNode, RefObject } from "react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"

type LessonSearchSheetProps = Readonly<{
  children: ReactNode
  isOpen: boolean
  onDismiss: () => void
  onReset: () => void
  submitLabel: string
  triggerRef: RefObject<HTMLButtonElement | null>
}>

export function LessonSearchSheet({
  children,
  isOpen,
  onDismiss,
  onReset,
  submitLabel,
  triggerRef,
}: LessonSearchSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (!isOpen) {
      if (dialog.open) dialog.close()
      return
    }
    if (!dialog.open) dialog.showModal()
    const initialFocus = dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")
    const frame = requestAnimationFrame(() => initialFocus?.focus())
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-in-out" })
      dialog
        .querySelector<HTMLElement>("[data-search-sheet]")
        ?.animate([{ transform: "translateY(100%)" }, { transform: "translateY(0)" }], {
          duration: 200,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        })
    }
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const body = document.body
    const scrollY = window.scrollY
    const previous = {
      left: body.style.left,
      overflow: body.style.overflow,
      position: body.style.position,
      right: body.style.right,
      top: body.style.top,
      width: body.style.width,
    }
    document.body.style.position = "fixed"
    body.style.left = "0"
    body.style.overflow = "hidden"
    body.style.right = "0"
    body.style.top = `-${scrollY}px`
    body.style.width = "100%"

    return () => {
      Object.assign(body.style, previous)
      window.scrollTo(0, scrollY)
    }
  }, [isOpen])

  return (
    <dialog
      aria-label="레슨 검색 조건"
      aria-modal="true"
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--overlay-scrim)] md:hidden"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
      onClose={() => triggerRef.current?.focus()}
      ref={dialogRef}
    >
      <div
        className="absolute inset-x-0 bottom-0 grid max-h-[94dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-t-[var(--radius-xl)] border border-line bg-canvas [box-shadow:var(--shadow-panel)]"
        data-search-sheet="true"
      >
        <header className="flex items-center justify-between gap-4 border-b border-line-subtle px-4 py-3">
          <div className="grid gap-0.5">
            <h1 className="m-0 text-lg font-bold text-primary">레슨 검색</h1>
            <p className="m-0 text-sm text-secondary">조건을 고른 뒤 적용해요.</p>
          </div>
          <button
            aria-label="검색 조건 닫기"
            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-circle)] text-secondary hover:bg-inset"
            onClick={onDismiss}
            type="button"
          >
            <X aria-hidden="true" className="size-5" strokeWidth={1.8} />
          </button>
        </header>
        <div className="grid content-start gap-5 overflow-y-auto overscroll-contain px-4 py-5">
          {children}
        </div>
        <footer className="grid grid-cols-[auto_1fr] gap-3 border-t border-line-subtle bg-canvas p-4">
          <Button onClick={onReset} type="button" variant="outline">
            <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.8} />
            초기화
          </Button>
          <Button type="submit">{submitLabel}</Button>
        </footer>
      </div>
    </dialog>
  )
}
