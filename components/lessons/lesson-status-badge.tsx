import { StatusBadge } from "@/components/ui/status-badge"
import type { LessonAuthoringData } from "@/lib/lessons/authoring-types"

type LessonStatus = LessonAuthoringData["status"]

const statusView: Record<
  LessonStatus,
  Readonly<{ label: string; tone: "error" | "neutral" | "success" | "warning" }>
> = {
  active: { label: "운영 중", tone: "success" },
  closed: { label: "종료", tone: "neutral" },
  draft: { label: "임시 저장", tone: "neutral" },
  paused: { label: "일시 중지", tone: "warning" },
  pending_review: { label: "검토 중", tone: "warning" },
  rejected: { label: "반려", tone: "error" },
}

export function LessonStatusBadge({ status }: Readonly<{ status: LessonStatus }>) {
  const view = statusView[status]
  return <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
}
