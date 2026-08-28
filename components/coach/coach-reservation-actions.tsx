"use client"

import { CheckCircle2, UserX } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"

type Action = "complete" | "mark_coach_no_show"

export function CoachReservationActions({ reservationId }: Readonly<{ reservationId: string }>) {
  const [busy, setBusy] = useState<Action | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)

  async function submit(action: Action) {
    if (busy) return
    setBusy(action)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/reservations/${reservationId}/${action === "complete" ? "complete" : "no-show"}`,
        {
          body: JSON.stringify(
            action === "complete" ? {} : { action, reason: "지도자 운영 화면에서 확인" },
          ),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Origin: window.location.origin },
          method: "POST",
        },
      )
      const body = (await response.json()) as {
        data?: { status?: string }
        error?: { message?: string }
      }
      if (!response.ok) {
        const text =
          response.status === 409
            ? "예약 상태가 이미 변경됐어요. 새로고침 후 확인해 주세요."
            : (body.error?.message ?? "상태를 변경하지 못했어요.")
        setMessage(text)
        requestAnimationFrame(() => errorRef.current?.focus())
        return
      }
      setMessage(
        `예약을 ${body.data?.status === "no_show_coach" ? "지도자 노쇼" : "완료"} 처리했어요.`,
      )
      window.location.reload()
    } catch {
      setMessage("연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.")
      requestAnimationFrame(() => errorRef.current?.focus())
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {message ? (
        <p
          aria-live="assertive"
          className="w-full m-0 text-sm text-[var(--status-error)]"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}
      <Button disabled={busy !== null} onClick={() => void submit("complete")}>
        <CheckCircle2 aria-hidden="true" className="size-4" />
        {busy === "complete" ? "처리 중…" : "수업 완료"}
      </Button>
      <Button
        disabled={busy !== null}
        onClick={() => void submit("mark_coach_no_show")}
        variant="outline"
      >
        <UserX aria-hidden="true" className="size-4" />
        {busy === "mark_coach_no_show" ? "처리 중…" : "지도자 노쇼"}
      </Button>
    </div>
  )
}
