import { BadgeCheck, CalendarClock, CircleDollarSign, Flag, ListChecks } from "lucide-react"
import { redirect } from "next/navigation"

import { AdminDashboardTile } from "@/components/admin/admin-dashboard-tile"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readAdminDashboardCounts } from "@/lib/admin/dashboard-read-model"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"
export const revalidate = 0

type Props = Readonly<{
  searchParams?: Promise<{ uiState?: string | readonly string[] }>
}>

export default async function AdminDashboardPage({ searchParams }: Props) {
  const auth = await readPageAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/admin")
  }
  if (auth.kind === "profile_required") redirect("/onboarding/profile")
  if (auth.profile.role !== "admin" || auth.profile.status !== "active") redirect("/mypage")

  const resolvedSearchParams: { readonly uiState?: string | readonly string[] } = searchParams
    ? await searchParams
    : {}
  const forceUiState = process.env["SPOLINK_AUTH_E2E_ADMIN_DASHBOARD_STATE"] === "enabled"
  if (forceUiState && resolvedSearchParams.uiState === "loading") {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  if (forceUiState && resolvedSearchParams.uiState === "error") {
    throw new Error("Injected admin dashboard failure")
  }

  const client = await createSupabaseServerComponentClient()
  const counts = await readAdminDashboardCounts(client)
  const queues = [
    {
      action: "심사 목록 보기",
      count: counts.coachApplications,
      href: "/admin/coaches?status=submitted&page=1&pageSize=20",
      icon: BadgeCheck,
      label: "지도자 심사",
    },
    {
      action: "승인 목록 보기",
      count: counts.lessonReviews,
      href: "/admin/lessons",
      icon: ListChecks,
      label: "레슨 승인",
    },
    {
      action: "신고 목록 보기",
      count: counts.openReports,
      href: "/admin/reports?status=open&page=1&pageSize=20",
      icon: Flag,
      label: "신고 처리",
    },
    {
      action: "분쟁 목록 보기",
      count: counts.disputedReservations,
      href: "/admin/reservations?status=disputed&page=1&pageSize=20",
      icon: CalendarClock,
      label: "분쟁 예약",
    },
    {
      action: "보류 목록 보기",
      count: counts.heldSettlements,
      href: "/admin/settlements?status=hold",
      icon: CircleDollarSign,
      label: "정산 보류",
    },
  ] as const

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1180px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3 border-b border-line pb-6">
          <StatusBadge tone="warning">관리자 운영</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary md:text-5xl">
            관리자 운영 현황
          </h1>
          <p className="m-0 max-w-[62ch] break-keep text-base leading-[1.7] text-secondary">
            현재 처리 대기 중인 운영 업무입니다.
          </p>
        </header>

        <ul
          aria-label="관리자 처리 대기 업무"
          className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3"
        >
          {queues.map((queue) => (
            <AdminDashboardTile key={queue.href} {...queue} />
          ))}
        </ul>
      </section>
    </main>
  )
}
