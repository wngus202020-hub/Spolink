import { FileWarning, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AdminReportStatusBadge } from "@/components/admin/admin-report-status-badge"
import { PublicHeader } from "@/components/layout/public-header"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createTrustSafetyServerClient } from "@/lib/trust-safety/client"
import { parseAdminReportQuery } from "@/lib/trust-safety/contract"
import { createAdminTrustSafetyDependencies } from "@/lib/trust-safety/repository"
import type { ReportTargetType } from "@/lib/trust-safety/types"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type AdminReportsPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>
}>

const filters = [
  { label: "전체", status: "all" },
  { label: "처리 필요", status: "open" },
  { label: "접수", status: "submitted" },
  { label: "검토 중", status: "reviewing" },
  { label: "조치 완료", status: "resolved" },
  { label: "기각", status: "rejected" },
] as const

export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/admin/reports")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")

  const params = toSearchParams(await searchParams)
  const query = params ? parseAdminReportQuery(params) : null
  if (!query) redirect("/admin/reports")
  const repository = createAdminTrustSafetyDependencies(await createTrustSafetyServerClient())
  const result = await repository.listReports(query)
  if (result.errorCode || !result.data) throw new AdminReportsReadError()

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3">
          <span className="inline-flex size-11 items-center justify-center rounded-full bg-inset text-accent">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
            신고 검토
          </h1>
          <p className="m-0 max-w-[68ch] break-keep text-base leading-[1.7] text-secondary">
            신고 상태와 명시적 조치를 분리해 검토하고, 처리 이력은 안전한 감사 로그로 남깁니다.
          </p>
        </header>

        <nav aria-label="신고 상태 필터" className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              aria-current={query.status === filter.status ? "page" : undefined}
              className={[
                "inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-bold",
                query.status === filter.status
                  ? "border-primary bg-primary text-canvas"
                  : "border-line bg-canvas text-secondary hover:bg-inset",
              ].join(" ")}
              href={
                filter.status === "open"
                  ? `/admin/reports?status=open&page=1&pageSize=${query.pageSize}`
                  : `/admin/reports?status=${filter.status}`
              }
              key={filter.status}
            >
              {filter.label}
            </Link>
          ))}
        </nav>

        {result.data.items.length === 0 ? (
          <section className="grid min-h-64 place-items-center rounded-[var(--radius-xl)] border border-line bg-subtle p-8 text-center">
            <div className="grid max-w-md gap-3 justify-items-center">
              <FileWarning aria-hidden="true" className="size-8 text-tertiary" />
              <h2 className="m-0 text-2xl font-bold text-primary">해당 상태의 신고가 없습니다.</h2>
              <p className="m-0 break-keep text-sm leading-[1.6] text-secondary">
                새 신고가 접수되거나 상태가 변경되면 이 목록에 표시됩니다.
              </p>
            </div>
          </section>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line border-y border-line p-0">
            {result.data.items.map((report) => (
              <li key={report.id}>
                <Link
                  className="grid min-h-28 gap-3 px-1 py-5 hover:bg-subtle sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4"
                  href={`/admin/reports/${report.id}`}
                >
                  <div className="min-w-0 grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminReportStatusBadge status={report.status} />
                      <span className="text-xs font-bold text-secondary">
                        {targetLabel(report.targetType)} 신고
                      </span>
                    </div>
                    <strong className="truncate text-base text-primary">{report.reason}</strong>
                    <span className="text-sm text-secondary">
                      접수 {formatDate(report.createdAt)}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-primary">상세 검토</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function toSearchParams(values: Readonly<Record<string, string | string[] | undefined>>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) return null
    if (typeof value === "string") params.set(key, value)
  }
  return params
}

function targetLabel(targetType: ReportTargetType) {
  const labels: Record<ReportTargetType, string> = {
    coach: "지도자",
    lesson: "레슨",
    reservation: "예약",
    review: "리뷰",
    user: "사용자",
  }
  return labels[targetType]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value))
}

class AdminReportsReadError extends Error {
  readonly name = "AdminReportsReadError"
}
