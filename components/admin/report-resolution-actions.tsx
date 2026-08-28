"use client"

import { CheckCircle2, SearchCheck, XCircle } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type {
  ModerationAction,
  ReportAction,
  ReportStatus,
  ReportTargetType,
} from "@/lib/trust-safety/types"

const moderationOptions: Readonly<
  Record<ReportTargetType, readonly Readonly<{ label: string; value: ModerationAction }>[]>
> = {
  coach: [
    { label: "추가 조치 없음", value: "none" },
    { label: "사용자 활동 정지", value: "suspend_user" },
  ],
  lesson: [
    { label: "추가 조치 없음", value: "none" },
    { label: "레슨 숨김", value: "hide_lesson" },
  ],
  reservation: [{ label: "추가 조치 없음", value: "none" }],
  review: [
    { label: "추가 조치 없음", value: "none" },
    { label: "리뷰 숨김", value: "hide_review" },
  ],
  user: [
    { label: "추가 조치 없음", value: "none" },
    { label: "사용자 활동 정지", value: "suspend_user" },
  ],
}

export function ReportResolutionActions({
  reportId,
  status,
  targetType,
}: Readonly<{ reportId: string; status: ReportStatus; targetType: ReportTargetType }>) {
  const alertRef = useRef<HTMLParagraphElement>(null)
  const [action, setAction] = useState<ReportAction>(
    status === "submitted" ? "start_review" : "resolve",
  )
  const [error, setError] = useState<string | null>(null)
  const [moderationAction, setModerationAction] = useState<ModerationAction>("none")
  const [pending, setPending] = useState(false)
  const [resolutionNote, setResolutionNote] = useState("")

  async function submit() {
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/reports/${reportId}/resolve`, {
        body: JSON.stringify({
          action,
          moderationAction: action === "resolve" ? moderationAction : "none",
          resolutionNote: action === "start_review" ? null : resolutionNote.trim(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      if (!response.ok) {
        setError(
          response.status === 409
            ? "다른 관리자가 먼저 상태를 변경했습니다. 새로고침 후 다시 확인해 주세요."
            : "신고 처리 결과를 저장하지 못했습니다.",
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
      setPending(false)
    }
  }

  const noteRequired = action !== "start_review"
  const disabled = pending || (noteRequired && resolutionNote.trim().length === 0)

  return (
    <section aria-labelledby="moderation-heading" className="grid gap-5 border-t border-line pt-6">
      <div className="grid gap-1">
        <h2 className="m-0 text-2xl font-bold text-primary" id="moderation-heading">
          처리 결정
        </h2>
        <p className="m-0 break-keep text-sm leading-[1.6] text-secondary">
          상태 변경과 실제 조치를 분리해 선택하고, 감사 기록에는 안전한 상태 값만 저장합니다.
        </p>
      </div>

      {status === "submitted" ? (
        <div className="rounded-[var(--radius-md)] border border-line bg-subtle p-4 text-sm text-secondary">
          접수된 신고는 먼저 검토 중으로 전환해야 합니다.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-primary">
            처리 결과
            <select
              className="min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 text-sm"
              onChange={(event) => {
                const nextAction = event.target.value === "reject" ? "reject" : "resolve"
                setAction(nextAction)
                if (nextAction === "reject") setModerationAction("none")
              }}
              value={action}
            >
              <option value="resolve">조치 완료</option>
              <option value="reject">신고 기각</option>
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold text-primary">
            명시적 조치
            <select
              className="min-h-11 rounded-[var(--radius-md)] border border-line bg-canvas px-3 text-sm disabled:bg-inset"
              disabled={action === "reject"}
              onChange={(event) => setModerationAction(readModerationAction(event.target.value))}
              value={moderationAction}
            >
              {moderationOptions[targetType].map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {noteRequired ? (
        <label className="grid gap-2 text-sm font-bold text-primary">
          처리 메모
          <textarea
            aria-describedby="resolution-note-help"
            className="min-h-28 resize-y rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-3 text-sm text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            maxLength={1000}
            onChange={(event) => setResolutionNote(event.target.value)}
            value={resolutionNote}
          />
          <span className="text-xs font-medium text-tertiary" id="resolution-note-help">
            개인정보를 복사하지 말고 판단 근거만 1,000자 이내로 기록하세요.
          </span>
        </label>
      ) : null}

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

      <div className="flex justify-end">
        <Button disabled={disabled} onClick={submit}>
          {action === "start_review" ? <SearchCheck aria-hidden="true" className="size-4" /> : null}
          {action === "resolve" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : null}
          {action === "reject" ? <XCircle aria-hidden="true" className="size-4" /> : null}
          {pending ? "저장 중" : actionLabel(action)}
        </Button>
      </div>
    </section>
  )
}

function readModerationAction(value: string): ModerationAction {
  switch (value) {
    case "hide_lesson":
    case "hide_review":
    case "none":
    case "suspend_user":
      return value
    default:
      return "none"
  }
}

function actionLabel(action: ReportAction) {
  switch (action) {
    case "start_review":
      return "검토 시작"
    case "resolve":
      return "처리 완료"
    case "reject":
      return "신고 기각"
    default:
      return action satisfies never
  }
}
