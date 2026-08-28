"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { transitionLesson } from "@/lib/lessons/authoring-client"

export function AdminLessonReviewActions({
  lessonId,
  updatedAt,
}: Readonly<{ lessonId: string; updatedAt: string }>) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  async function decide(action: "approve" | "reject") {
    setBusy(true)
    setMessage(null)
    const result = await transitionLesson(lessonId, {
      action,
      expectedUpdatedAt: updatedAt,
      reason: action === "reject" ? reason : null,
    })
    setBusy(false)
    if (result.status === "failure") {
      setMessage(result.message)
      return
    }
    setMessage(action === "approve" ? "레슨을 승인했습니다." : "레슨을 반려했습니다.")
    router.refresh()
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-2 text-sm font-bold text-primary">
        반려 사유
        <textarea
          className="min-h-24 resize-y rounded-[var(--radius-md)] border border-line bg-canvas p-3 text-primary"
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
      </label>
      {message ? (
        <p aria-live="polite" className="m-0 text-sm text-secondary">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => decide("approve")}>
          승인
        </Button>
        <Button
          disabled={busy || reason.trim().length === 0}
          onClick={() => decide("reject")}
          variant="outline"
        >
          반려
        </Button>
      </div>
    </div>
  )
}
