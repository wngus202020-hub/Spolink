import { StatusBadge } from "@/components/ui/status-badge"
import type { ReportStatus } from "@/lib/trust-safety/types"

const statusView = {
  rejected: { label: "기각", tone: "error" },
  resolved: { label: "조치 완료", tone: "success" },
  reviewing: { label: "검토 중", tone: "warning" },
  submitted: { label: "접수", tone: "neutral" },
} as const satisfies Record<
  ReportStatus,
  Readonly<{ label: string; tone: "error" | "neutral" | "success" | "warning" }>
>

export function AdminReportStatusBadge({ status }: Readonly<{ status: ReportStatus }>) {
  const view = statusView[status]
  return <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
}
