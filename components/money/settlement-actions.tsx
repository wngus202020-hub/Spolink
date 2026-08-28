"use client"

import { CheckCircle2, CirclePause } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"

export function SettlementActions({ settlementId }: Readonly<{ settlementId: string }>) {
  const [pending, setPending] = useState<"approve" | "hold" | null>(null)
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)

  async function submit(action: "approve" | "hold") {
    if (pending || (action === "hold" && reason.trim().length === 0)) return
    setPending(action)
    setMessage(null)
    try {
      const response = await fetch(`/api/settlements/${settlementId}/${action}`, {
        body: JSON.stringify(action === "hold" ? { reason: reason.trim() } : {}),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        method: "POST",
      })
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "정산 상태가 이미 변경됐어요."
            : "정산 상태를 변경하지 못했어요.",
        )
      setMessage(
        action === "hold"
          ? "정산을 보류했어요."
          : "정산을 승인했어요. 실제 지급 실행은 포함되지 않아요.",
      )
      window.location.reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했어요.")
      requestAnimationFrame(() => messageRef.current?.focus())
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-bold text-primary">
        보류 사유
        <input
          className="min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 text-sm font-normal"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending !== null} onClick={() => void submit("approve")}>
          <CheckCircle2 aria-hidden="true" className="size-4" />
          {pending === "approve" ? "처리 중…" : "승인"}
        </Button>
        <Button
          disabled={pending !== null || reason.trim().length === 0}
          onClick={() => void submit("hold")}
          variant="outline"
        >
          <CirclePause aria-hidden="true" className="size-4" />
          {pending === "hold" ? "처리 중…" : "보류"}
        </Button>
      </div>
      {message ? (
        <p
          aria-live="assertive"
          className="m-0 text-sm text-[var(--status-error)]"
          ref={messageRef}
          role="alert"
          tabIndex={-1}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
