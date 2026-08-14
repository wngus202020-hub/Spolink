import { ChevronLeft, ChevronRight, ClipboardCheck, MapPin } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AdminCoachStatusBadge } from "@/components/admin/admin-coach-status-badge"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"
import { createAdminReviewDependencies } from "@/lib/coach-certification/admin-repository"
import { parseAdminCoachListQuery } from "@/lib/coach-certification/contract"
import type { CoachStatus } from "@/lib/profile/types"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

const statusFilters = ["submitted", "approved", "rejected", "suspended", "draft"] as const
const statusLabels = {
  approved: "승인",
  draft: "작성 중",
  rejected: "반려",
  submitted: "심사 대기",
  suspended: "활동 제한",
} as const satisfies Record<CoachStatus, string>

type AdminCoachListPageProps = Readonly<{
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>
}>

export default async function AdminCoachListPage({ searchParams }: AdminCoachListPageProps) {
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/admin/coaches")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.kind === "account_deleted") redirect("/auth/restricted?reason=account-deleted")
  if (auth.kind === "account_suspended") redirect("/auth/restricted?reason=account-suspended")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")

  const values = await searchParams
  const queryParams = new URLSearchParams()
  for (const key of ["status", "page", "pageSize"] as const) {
    const value = values[key]
    if (typeof value === "string") queryParams.set(key, value)
  }
  const query = parseAdminCoachListQuery(queryParams)
  if (!query) redirect("/admin/coaches?status=submitted&page=1&pageSize=20")

  const supabase = await createSupabaseServerComponentClient()
  const result = await createAdminReviewDependencies(supabase).listApplications(query)
  if (result.errorCode || !result.data) throw new AdminCoachListReadError()
  const data = result.data
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1280px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-3">
            <StatusBadge tone="warning">관리자 심사</StatusBadge>
            <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl">
              지도자 인증 심사
            </h1>
            <p className="m-0 max-w-[62ch] break-keep text-base leading-[1.7] text-secondary">
              제출된 신청서와 자격증을 확인하고 승인 또는 반려해요.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-bold text-secondary">
            <ClipboardCheck aria-hidden="true" className="size-5 text-accent" />총 {data.total}건
          </span>
        </header>

        <nav aria-label="지도자 인증 상태 필터" className="flex flex-wrap gap-2 pb-1">
          {statusFilters.map((status) => (
            <Link
              aria-current={query.status === status ? "page" : undefined}
              className={[
                "inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-bold",
                query.status === status
                  ? "border-primary bg-primary text-canvas"
                  : "border-line bg-canvas text-secondary hover:bg-inset",
              ].join(" ")}
              href={`/admin/coaches?status=${status}&page=1&pageSize=${query.pageSize}`}
              key={status}
            >
              {statusLabels[status]}
            </Link>
          ))}
        </nav>

        <section
          aria-label="지도자 인증 신청 목록"
          className="overflow-hidden rounded-[var(--radius-xl)] border border-line bg-canvas"
        >
          {data.items.length === 0 ? (
            <div className="grid min-h-56 place-items-center px-5 py-12 text-center">
              <div className="grid max-w-sm gap-2">
                <strong className="text-lg text-primary">해당 상태의 신청서가 없습니다</strong>
                <span className="break-keep text-sm leading-[1.6] text-secondary">
                  다른 상태 필터를 선택해 심사 기록을 확인해 보세요.
                </span>
              </div>
            </div>
          ) : (
            <>
              <ul className="m-0 grid list-none divide-y divide-line p-0 lg:hidden">
                {data.items.map((item) => (
                  <li className="grid gap-4 p-5" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        className="grid gap-1 font-bold text-primary hover:text-accent"
                        href={`/admin/coaches/${item.id}`}
                      >
                        {item.displayName}
                        <span className="font-normal text-xs text-secondary">
                          {item.headline ?? "소개 미등록"}
                        </span>
                      </Link>
                      <AdminCoachStatusBadge status={item.status} />
                    </div>
                    <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
                      <MobileSummary label="전문 분야" value={item.sportName ?? "미등록"} />
                      <MobileSummary label="자격증" value={`${item.certificateCount}개`} />
                      <MobileSummary label="활동 지역" value={item.serviceRegion} />
                      <MobileSummary label="제출일" value={formatDate(item.submittedAt)} />
                    </dl>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="bg-inset text-xs text-secondary">
                    <tr>
                      <th className="px-5 py-4 font-bold" scope="col">
                        신청자
                      </th>
                      <th className="px-5 py-4 font-bold" scope="col">
                        전문 분야
                      </th>
                      <th className="px-5 py-4 font-bold" scope="col">
                        활동 지역
                      </th>
                      <th className="px-5 py-4 font-bold" scope="col">
                        자격증
                      </th>
                      <th className="px-5 py-4 font-bold" scope="col">
                        상태
                      </th>
                      <th className="px-5 py-4 font-bold" scope="col">
                        제출일
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((item) => (
                      <tr className="min-h-12 hover:bg-subtle" key={item.id}>
                        <td className="px-5 py-4">
                          <Link
                            className="grid gap-1 font-bold text-primary hover:text-accent"
                            href={`/admin/coaches/${item.id}`}
                          >
                            {item.displayName}
                            <span className="font-normal text-xs text-secondary">
                              {item.headline ?? "소개 미등록"}
                            </span>
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-sm text-secondary">
                          {item.sportName ?? "미등록"}
                        </td>
                        <td className="px-5 py-4 text-sm text-secondary">
                          <span className="inline-flex items-center gap-2">
                            <MapPin aria-hidden="true" className="size-4" />
                            {item.serviceRegion}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-secondary">
                          {item.certificateCount}개
                        </td>
                        <td className="px-5 py-4">
                          <AdminCoachStatusBadge status={item.status} />
                        </td>
                        <td className="px-5 py-4 text-sm text-secondary">
                          {formatDate(item.submittedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <nav aria-label="신청 목록 페이지" className="flex items-center justify-end gap-3">
          <PaginationLink
            disabled={query.page <= 1}
            direction="previous"
            href={pageHref(query.status, query.page - 1, query.pageSize)}
          />
          <span className="text-sm font-bold text-secondary">
            {query.page} / {pageCount}
          </span>
          <PaginationLink
            disabled={query.page >= pageCount}
            direction="next"
            href={pageHref(query.status, query.page + 1, query.pageSize)}
          />
        </nav>
      </section>
    </main>
  )
}

function MobileSummary({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-bold text-secondary">{label}</dt>
      <dd className="m-0 break-keep font-bold text-primary">{value}</dd>
    </div>
  )
}

function PaginationLink({
  disabled,
  direction,
  href,
}: Readonly<{ disabled: boolean; direction: "next" | "previous"; href: string }>) {
  const label = direction === "previous" ? "이전" : "다음"
  const icon =
    direction === "previous" ? (
      <ChevronLeft aria-hidden="true" className="size-4" />
    ) : (
      <ChevronRight aria-hidden="true" className="size-4" />
    )
  return disabled ? (
    <span
      aria-disabled="true"
      className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-md)] border border-line px-4 text-sm text-tertiary"
    >
      {icon}
      {label}
    </span>
  ) : (
    <Link
      className="inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-md)] border border-line px-4 text-sm font-bold text-primary hover:bg-inset"
      href={href}
    >
      {icon}
      {label}
    </Link>
  )
}

function pageHref(status: CoachStatus, page: number, pageSize: number) {
  return `/admin/coaches?status=${status}&page=${page}&pageSize=${pageSize}`
}

function formatDate(value: string | null) {
  if (!value) return "미제출"
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeZone: "Asia/Seoul" }).format(
    new Date(value),
  )
}

class AdminCoachListReadError extends Error {
  readonly name = "AdminCoachListReadError"
}
