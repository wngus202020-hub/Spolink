import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { AdminReservationActions } from "@/components/admin/admin-reservation-actions"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  createSupabaseServerComponentClient,
  readServerAuthProfile,
} from "@/lib/auth/server-profile"
import { createAdminReservationDependencies } from "@/lib/reservations/admin-operations"

export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

export default async function AdminReservationPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ reservationId: string }>
  searchParams: Promise<{ uiState?: string }>
}>) {
  const auth = await readServerAuthProfile()
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured")
    redirect("/auth/login?next=/admin/reservations")
  if (auth.kind !== "ready" || auth.profile.role !== "admin" || auth.profile.status !== "active")
    redirect("/mypage")
  const { uiState } = await searchParams
  const forceUiState = process.env["SPOLINK_AUTH_E2E_ADMIN_RESERVATION_STATE"] === "enabled"
  if (forceUiState && uiState === "loading") {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  if (forceUiState && uiState === "error") {
    throw new Error("Injected admin reservation detail failure")
  }
  const id = (await params).reservationId
  const result = await createAdminReservationDependencies(
    await createSupabaseServerComponentClient(),
  ).readReservation(id)
  if (result.errorCode === "P0002" || !result.data) notFound()
  if (result.errorCode) throw new Error("Admin reservation read failed")
  const reservation = result.data
  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />
      <section className="mx-auto grid w-full max-w-[900px] gap-7 px-4 pb-16 pt-8 md:px-6 md:pt-12">
        <Link
          className="text-sm font-bold text-secondary underline-offset-4 hover:underline"
          href="/admin/reservations"
        >
          ← 예약 운영으로 돌아가기
        </Link>
        <header className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge
              tone={
                reservation.status === "completed"
                  ? "success"
                  : reservation.status === "disputed"
                    ? "error"
                    : "warning"
              }
            >
              {reservation.status}
            </StatusBadge>
            <span className="text-sm text-secondary">{reservation.id}</span>
          </div>
          <h1 className="m-0 text-3xl font-bold text-primary">
            {reservation.lessonTitle ?? "레슨 정보 없음"}
          </h1>
        </header>
        <dl className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 sm:grid-cols-2">
          <Info label="학습자" value={reservation.learnerName ?? "정보 없음"} />
          <Info label="지도자" value={reservation.coachName ?? "정보 없음"} />
          <Info label="일정" value={reservation.scheduleStartsAt ?? "정보 없음"} />
          <Info label="결제" value={reservation.paymentStatus ?? "정보 없음"} />
          <Info label="금액" value={`${reservation.amount.toLocaleString("ko-KR")}원`} />
          <Info label="환불" value={reservation.refundStatus ?? "없음"} />
        </dl>
        <AdminReservationActions reservationId={reservation.id} />
      </section>
    </main>
  )
}

function Info({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-bold text-secondary">{label}</dt>
      <dd className="m-0 font-bold text-primary">{value}</dd>
    </div>
  )
}
