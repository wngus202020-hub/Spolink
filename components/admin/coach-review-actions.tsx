"use client"

import { CheckCircle2, XCircle } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"

export function CoachReviewActions({ coachProfileId }: Readonly<{ coachProfileId: string }>) {
  const alertRef = useRef<HTMLParagraphElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<"approve" | "reject" | null>(null)
  const [rejectionReason, setRejectionReason] = useState("")

  async function review(decision: "approve" | "reject") {
    setPending(decision)
    setError(null)
    try {
      const response = await fetch(`/api/admin/coach-profiles/${coachProfileId}/${decision}`, {
        body: JSON.stringify(
          decision === "approve" ? {} : { rejectionReason: rejectionReason.trim() },
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError(
          response.status === 409
            ? "이미 다른 심사 결과가 반영되었습니다."
            : "심사 결과를 저장하지 못했습니다.",
        )
        requestAnimationFrame(() => alertRef.current?.focus())
        return
      }
      window.location.reload()
    } catch (caught) {
      if (caught instanceof TypeError) {
        setError("네트워크 연결을 확인해 주세요.")
        requestAnimationFrame(() => alertRef.current?.focus())
        return
      }
      throw caught
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      aria-labelledby="review-actions-heading"
      className="grid gap-4 border-t border-line pt-6"
    >
      <div className="grid gap-1">
        <h2 className="m-0 text-xl font-bold text-primary" id="review-actions-heading">
          심사 결정
        </h2>
        <p className="m-0 break-keep text-sm leading-[1.6] text-secondary">
          반려 시 신청자가 보완할 수 있도록 구체적인 사유를 입력해 주세요.
        </p>
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-bold text-primary" htmlFor="rejection-reason">
          반려 사유
        </label>
        <textarea
          aria-describedby="rejection-reason-help"
          className="min-h-28 resize-y rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-3 text-sm text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          id="rejection-reason"
          maxLength={1000}
          onChange={(event) => setRejectionReason(event.target.value)}
          placeholder="예: 자격증 이미지의 발급 기관과 번호를 확인할 수 없습니다."
          value={rejectionReason}
        />
        <p className="m-0 text-xs text-tertiary" id="rejection-reason-help">
          1자 이상 1,000자 이하
        </p>
      </div>
      {error ? (
        <p
          aria-live="assertive"
          className="m-0 rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-3 text-sm text-[var(--status-error)] focus:outline-2 focus:outline-offset-2 focus:outline-primary"
          ref={alertRef}
          role="alert"
          tabIndex={-1}
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          disabled={pending !== null || rejectionReason.trim().length === 0}
          onClick={() => review("reject")}
          variant="outline"
        >
          <XCircle aria-hidden="true" className="size-4" />
          {pending === "reject" ? "반려 처리 중" : "반려"}
        </Button>
        <Button disabled={pending !== null} onClick={() => review("approve")}>
          <CheckCircle2 aria-hidden="true" className="size-4" />
          {pending === "approve" ? "승인 처리 중" : "승인"}
        </Button>
      </div>
    </section>
  )
}
