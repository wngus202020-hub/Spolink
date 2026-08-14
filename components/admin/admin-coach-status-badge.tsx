import { StatusBadge } from "@/components/ui/status-badge"
import type { CoachStatus } from "@/lib/profile/types"

const statusView = {
  approved: { label: "승인", tone: "success" },
  draft: { label: "작성 중", tone: "neutral" },
  rejected: { label: "반려", tone: "error" },
  submitted: { label: "심사 대기", tone: "warning" },
  suspended: { label: "활동 제한", tone: "error" },
} as const satisfies Record<
  CoachStatus,
  Readonly<{ label: string; tone: "error" | "neutral" | "success" | "warning" }>
>

export function AdminCoachStatusBadge({ status }: Readonly<{ status: CoachStatus }>) {
  const view = statusView[status]
  return <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
}
