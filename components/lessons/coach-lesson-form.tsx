"use client"

import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  createLessonDraft,
  transitionLesson,
  updateLessonDraft,
} from "@/lib/lessons/authoring-client"
import type { LessonAuthoringData } from "@/lib/lessons/authoring-types"
import {
  type CoachLessonFieldValues,
  CoachLessonFormFields,
  type CoachLessonSportOption,
  readLessonDraftForm,
} from "./coach-lesson-form-fields"
import { runNewLessonSubmission } from "./coach-lesson-new-flow"
import { LessonImageManager } from "./lesson-image-manager"
import { type CoachLessonInitialImage, useCoachLessonImages } from "./use-coach-lesson-images"

type LessonFormValue = CoachLessonFieldValues &
  Readonly<{
    id: string
    status: LessonAuthoringData["status"]
    updatedAt: string
  }>

type CoachLessonFormProps = Readonly<{
  initialImages?: readonly CoachLessonInitialImage[]
  initial?: LessonFormValue
  sports: readonly CoachLessonSportOption[]
}>

export function CoachLessonForm({ initial, initialImages = [], sports }: CoachLessonFormProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Readonly<{
    kind: "error" | "success"
    text: string
  }> | null>(null)
  const [draftId, setDraftId] = useState(initial?.id ?? null)
  const [version, setVersion] = useState(initial?.updatedAt ?? null)
  const alertRef = useRef<HTMLParagraphElement>(null)
  const editable = !initial || initial.status === "draft" || initial.status === "rejected"
  const images = useCoachLessonImages({
    initialImages,
    lessonId: draftId,
    mutable: editable && !busy,
  })

  useEffect(() => {
    if (message?.kind === "error") alertRef.current?.focus()
  }, [message])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const input = readLessonDraftForm(new FormData(event.currentTarget))
    if (!initial) {
      const result = await runNewLessonSubmission({
        createDraft: createLessonDraft,
        draft: input,
        draftId,
        updateDraft: updateLessonDraft,
        uploadImages: images.uploadImages,
        version,
      })
      setBusy(false)
      if (result.status === "draft_failure") {
        setMessage({ kind: "error", text: result.message })
        return
      }
      setDraftId(result.draftId)
      setVersion(result.updatedAt)
      if (result.status === "image_failure") {
        setMessage({
          kind: "error",
          text: "레슨 초안은 저장되었습니다. 이미지 업로드를 완료하지 못했습니다.",
        })
        return
      }
      router.replace(result.redirectHref)
      return
    }

    const result = await updateLessonDraft(initial.id, {
      ...input,
      expectedUpdatedAt: version ?? initial.updatedAt,
    })
    if (result.status === "failure") {
      setBusy(false)
      setMessage({ kind: "error", text: result.message })
      return
    }
    setDraftId(result.data.id)
    setVersion(result.data.updatedAt)
    setBusy(false)
    setMessage({ kind: "success", text: "레슨 초안을 저장했습니다." })
  }

  async function retryImages() {
    if (!draftId) return
    setMessage(null)
    const uploaded = await images.uploadImages(draftId)
    if (!uploaded) {
      setMessage({
        kind: "error",
        text: initial
          ? "이미지 업로드를 완료하지 못했습니다."
          : "레슨 초안은 저장되었습니다. 이미지 업로드를 완료하지 못했습니다.",
      })
      return
    }
    setMessage({ kind: "success", text: "이미지를 저장했습니다." })
    if (!initial) router.replace(`/coach/lessons/${draftId}/edit`)
  }

  async function handleSubmitForReview() {
    if (!initial || !version || images.blockingReview) return
    setBusy(true)
    setMessage(null)
    const result = await transitionLesson(initial.id, {
      action: "submit",
      expectedUpdatedAt: version,
      reason: null,
    })
    setBusy(false)
    if (result.status === "failure") {
      setMessage({
        kind: "error",
        text:
          result.statusCode === 409
            ? "레슨 또는 이미지 상태가 변경되었습니다. 이 페이지를 새로 열어 다시 시도해 주세요."
            : result.message,
      })
      return
    }
    setMessage({ kind: "success", text: "관리자 검토를 요청했습니다." })
    router.replace("/coach/lessons")
  }

  return (
    <form className="grid gap-5" onSubmit={handleSubmit}>
      <CoachLessonFormFields disabled={!editable || busy} initial={initial} sports={sports} />
      <LessonImageManager {...images.managerProps} />
      {images.imageMessage ? (
        <p aria-live="assertive" className="m-0 text-sm text-primary" role="alert">
          {images.imageMessage}
        </p>
      ) : null}
      {message ? (
        <p
          aria-live={message.kind === "error" ? "assertive" : "polite"}
          className="m-0 rounded-[var(--radius-md)] bg-inset p-4 text-sm text-primary focus:outline-2 focus:outline-offset-2 focus:outline-primary"
          ref={alertRef}
          role={message.kind === "error" ? "alert" : "status"}
          tabIndex={message.kind === "error" ? -1 : undefined}
        >
          {message.text}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!editable || busy || images.imageBusy} type="submit">
          {busy ? "저장 중…" : "임시 저장"}
        </Button>
        {images.hasQueued ? (
          <Button
            disabled={!draftId || busy || images.imageBusy}
            onClick={() => void retryImages()}
            type="button"
            variant="secondary"
          >
            {images.retryable ? "이미지만 다시 시도" : "이미지 저장"}
          </Button>
        ) : null}
        {initial && (initial.status === "draft" || initial.status === "rejected") ? (
          <Button
            disabled={busy || images.imageBusy || images.blockingReview}
            onClick={handleSubmitForReview}
            type="button"
            variant="secondary"
          >
            검토 요청
          </Button>
        ) : null}
      </div>
      {initial && images.blockingReview ? (
        <p className="m-0 text-sm text-secondary">
          이미지 작업을 마친 후 검토를 요청할 수 있습니다.
        </p>
      ) : null}
    </form>
  )
}
