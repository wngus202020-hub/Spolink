import Link from "next/link"
import { redirect } from "next/navigation"

import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"
import {
  createAdminReservationDependencies,
  parseAdminReservationQuery,
} from "@/lib/reservations/admin-operations"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

type Props = Readonly<{
  searchParams: Promise<{ page?: string; pageSize?: string; status?: string; uiState?: string }>
}>

export default async function AdminReservationsPage({ searchParams }: Props) {
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/admin/reservations")
  if (auth.kind !== "ready" || auth.profile.role !== "admin" || auth.profile.status !== "active")
    redirect("/mypage")
  const resolvedSearchParams = await searchParams
  const forceUiState = process.env["SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE"] === "enabled"
  if (forceUiState && resolvedSearchParams.uiState === "loading") {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  if (forceUiState && resolvedSearchParams.uiState === "error") {
    throw new Error("Injected admin reservation list failure")
  }
  const query = parseAdminReservationQuery(new URLSearchParams(resolvedSearchParams))
  if (!query) redirect("/admin/reservations")
  const result = await createAdminReservationDependencies(
    await createSupabaseServerComponentClient(),
  ).listReservations(query)
  if (result.errorCode || !result.data) throw new Error("Admin reservation read failed")
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[1180px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <header className="grid gap-3">
          <StatusBadge tone="warning">관리자 운영</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-tight text-primary md:text-5xl">
            예약 운영
          </h1>
          <p className="m-0 text-secondary">
            예약 상태와 결제·환불 연결 상태를 확인하고 승인된 운영 명령을 실행합니다.
          </p>
        </header>
        {result.data.items.length === 0 ? (
          <div className="grid min-h-56 place-items-center rounded-[var(--radius-xl)] border border-dashed border-line bg-subtle p-6 text-center">
            <strong className="text-primary">조건에 맞는 예약이 없습니다</strong>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {result.data.items.map((item) => (
              <li
                className="grid gap-3 rounded-[var(--radius-lg)] border border-line bg-canvas p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                key={item.id}
              >
                <div className="grid gap-1">
                  <Link
                    className="text-lg font-bold text-primary underline-offset-4 hover:underline"
                    href={`/admin/reservations/${item.id}`}
                  >
                    {item.lessonTitle ?? "레슨 정보 없음"}
                  </Link>
                  <span className="text-sm text-secondary">
                    {item.learnerName ?? "학습자 정보 없음"} ·{" "}
                    {item.coachName ?? "지도자 정보 없음"}
                  </span>
                  <span className="text-sm text-secondary">
                    {item.scheduleStartsAt ?? "일정 정보 없음"}
                  </span>
                </div>
                <StatusBadge
                  tone={
                    item.status === "completed"
                      ? "success"
                      : item.status === "disputed"
                        ? "error"
                        : "warning"
                  }
                >
                  {item.status}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
