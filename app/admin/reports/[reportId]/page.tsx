import { ArrowLeft, CalendarDays, Target } from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { AdminReportStatusBadge } from "@/components/admin/admin-report-status-badge"
import { ReportResolutionActions } from "@/components/admin/report-resolution-actions"
import { PublicHeader } from "@/components/layout/public-header"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createTrustSafetyServerClient } from "@/lib/trust-safety/client"
import { createAdminTrustSafetyDependencies } from "@/lib/trust-safety/repository"
import type { ModerationAction, ReportTargetType } from "@/lib/trust-safety/types"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type AdminReportPageProps = Readonly<{
  params: Promise<Readonly<{ reportId: string }>>
}>

export default async function AdminReportPage({ params }: AdminReportPageProps) {
  const { reportId } = await params
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=/admin/reports/${reportId}`)
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")

  const repository = createAdminTrustSafetyDependencies(await createTrustSafetyServerClient())
  const result = await repository.readReport(reportId)
  if (result.errorCode === "P0002") notFound()
  if (result.errorCode || !result.data) throw new AdminReportReadError()
  const report = result.data

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[960px] gap-6 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <Link
          className="inline-flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-secondary hover:text-primary"
          href="/admin/reports"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          신고 목록
        </Link>

        <header className="grid gap-3">
          <AdminReportStatusBadge status={report.status} />
          <h1 className="m-0 break-keep text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
            신고 상세 검토
          </h1>
          <p className="m-0 text-base leading-[1.7] text-secondary">{report.reason}</p>
        </header>

        <section className="grid gap-6 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-7">
          <dl className="m-0 grid gap-4 sm:grid-cols-2">
            <Info label="대상 유형" value={targetLabel(report.targetType)}>
              <Target aria-hidden="true" className="size-4" />
            </Info>
            <Info label="접수 시각" value={formatDate(report.createdAt)}>
              <CalendarDays aria-hidden="true" className="size-4" />
            </Info>
            <Info label="검토 시각" value={formatDate(report.reviewedAt)}>
              <CalendarDays aria-hidden="true" className="size-4" />
            </Info>
            <Info label="적용 조치" value={moderationLabel(report.moderationAction)}>
              <Target aria-hidden="true" className="size-4" />
            </Info>
          </dl>

          <div className="grid gap-2 border-t border-line pt-5">
            <h2 className="m-0 text-lg font-bold text-primary">신고 상세</h2>
            <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.7] text-secondary">
              {report.detail ?? "상세 내용이 입력되지 않았습니다."}
            </p>
          </div>

          {report.resolutionNote ? (
            <div className="grid gap-2 border-t border-line pt-5">
              <h2 className="m-0 text-lg font-bold text-primary">처리 메모</h2>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-[1.7] text-secondary">
                {report.resolutionNote}
              </p>
            </div>
          ) : null}
        </section>

        {report.status === "submitted" || report.status === "reviewing" ? (
          <ReportResolutionActions
            reportId={report.id}
            status={report.status}
            targetType={report.targetType}
          />
        ) : null}
      </section>
    </main>
  )
}

function Info({
  children,
  label,
  value,
}: Readonly<{ children: React.ReactNode; label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="inline-flex items-center gap-2 text-xs font-bold text-secondary">
        {children}
        {label}
      </dt>
      <dd className="m-0 text-sm font-bold text-primary">{value}</dd>
    </div>
  )
}

function targetLabel(value: ReportTargetType) {
  const labels: Record<ReportTargetType, string> = {
    coach: "지도자",
    lesson: "레슨",
    reservation: "예약",
    review: "리뷰",
    user: "사용자",
  }
  return labels[value]
}

function moderationLabel(value: ModerationAction | null) {
  if (!value) return "아직 결정되지 않음"
  const labels: Record<ModerationAction, string> = {
    hide_lesson: "레슨 숨김",
    hide_review: "리뷰 숨김",
    none: "추가 조치 없음",
    suspend_user: "사용자 활동 정지",
  }
  return labels[value]
}

function formatDate(value: string | null) {
  if (!value) return "기록 없음"
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))
}

class AdminReportReadError extends Error {
  readonly name = "AdminReportReadError"
}
