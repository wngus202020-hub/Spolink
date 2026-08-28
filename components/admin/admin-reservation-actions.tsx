"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  ADMIN_RESERVATION_ACTIONS,
  type AdminReservationAction,
} from "@/lib/reservations/admin-operations"

const labels: Record<AdminReservationAction, string> = {
  cancel: "관리자 취소",
  complete: "완료 처리",
  mark_coach_no_show: "지도자 노쇼",
  mark_learner_no_show: "학습자 노쇼",
  open_dispute: "분쟁 시작",
}

export function AdminReservationActions({ reservationId }: Readonly<{ reservationId: string }>) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState<AdminReservationAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(action: AdminReservationAction) {
    setBusy(action)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/admin/reservations/${reservationId}/status`, {
        body: JSON.stringify({ action, reason: reason.trim() || null }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      const body = (await response.json()) as {
        data?: { status?: string }
        error?: { code?: string }
      }
      if (!response.ok) {
        setError(
          body.error?.code === "CONFLICT"
            ? "다른 관리자가 먼저 상태를 변경했습니다."
            : "상태를 변경하지 못했습니다.",
        )
        return
      }
      setMessage(`상태가 ${body.data?.status ?? "변경"} 처리되었습니다.`)
    } catch {
      setError("네트워크 오류가 발생했습니다.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="grid gap-3 border-t border-line pt-5" aria-live="polite">
      <label
        className="grid gap-2 text-sm font-bold text-primary"
        htmlFor="admin-reservation-reason"
      >
        처리 사유
        <textarea
          className="min-h-24 rounded-[var(--radius-md)] border border-line bg-canvas p-3 font-normal text-primary"
          id="admin-reservation-reason"
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
          placeholder="상태 변경 사유를 입력하세요"
          value={reason}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_RESERVATION_ACTIONS.map((action) => (
          <Button
            disabled={busy !== null}
            key={action}
            onClick={() => submit(action)}
            variant={action === "cancel" ? "outline" : "primary"}
          >
            {busy === action ? "처리 중…" : labels[action]}
          </Button>
        ))}
      </div>
      {message ? (
        <p className="m-0 text-sm font-bold text-[var(--status-success)]" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="m-0 text-sm font-bold text-[var(--status-error)]" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
