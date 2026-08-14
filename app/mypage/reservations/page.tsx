import { ArrowLeft, ArrowRight, CalendarDays, CircleAlert, MapPin, ReceiptText } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import {
  normalizeReservationFilter,
  normalizeReservationPage,
  RESERVATION_FILTERS,
  type ReservationFilter,
  type ReservationSummaryView,
  readReservationListData,
} from "@/lib/reservations/read-model"

type MyReservationsPageProps = Readonly<{
  searchParams: Promise<{
    page?: string | string[]
    status?: string | string[]
  }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MyReservationsPage({ searchParams }: MyReservationsPageProps) {
  const [auth, query] = await Promise.all([readPageAuthProfile(), searchParams])
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect("/auth/login?next=/mypage/reservations")
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const filter = normalizeReservationFilter(query.status)
  const page = normalizeReservationPage(query.page)
  const reservationData = await readReservationListData(auth.profile.id, filter, page)

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-14 pt-6 md:px-6 md:pt-10">
        <Link
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
          href="/mypage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          마이페이지
        </Link>

        <div className="grid gap-3">
          <StatusBadge tone="neutral">예약 관리</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
            내 예약
          </h1>
          <p className="m-0 max-w-[66ch] text-base leading-[1.7] text-secondary md:text-lg">
            예약 상태와 결제·환불 내역을 확인해요.
          </p>
        </div>

        <nav aria-label="예약 상태 필터" className="flex gap-2 overflow-x-auto pb-1">
          {RESERVATION_FILTERS.map((item) => {
            const selected = item.value === filter
            return (
              <Link
                aria-current={selected ? "page" : undefined}
                className={[
                  "inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-bold",
                  selected
                    ? "border-primary bg-primary text-canvas"
                    : "border-line bg-canvas text-secondary hover:bg-inset",
                ].join(" ")}
                href={filterHref(item.value)}
                key={item.value}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        {reservationData.state === "read_failure" ? (
          <section
            className="grid gap-3 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)]"
            role="alert"
          >
            <CircleAlert
              aria-hidden="true"
              className="size-6 text-[var(--status-warning)]"
              strokeWidth={1.8}
            />
            <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
              예약 내역을 불러오지 못했어요
            </h2>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              잠시 후 페이지를 다시 열어 봐요.
            </p>
          </section>
        ) : null}

        {reservationData.state === "empty" && reservationData.viewModel ? (
          <EmptyReservationState
            filter={filter}
            page={reservationData.viewModel.page}
            totalCount={reservationData.viewModel.totalCount}
            totalPages={reservationData.viewModel.totalPages}
          />
        ) : null}

        {reservationData.state === "ready" && reservationData.viewModel ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
              <div className="grid gap-1">
                <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">예약 내역</h2>
                <p className="m-0 text-sm text-secondary">
                  총 {reservationData.viewModel.totalCount.toLocaleString("ko-KR")}건
                </p>
              </div>
              <span className="text-sm font-bold text-secondary">
                {reservationData.viewModel.page} / {reservationData.viewModel.totalPages} 페이지
              </span>
            </div>

            <div className="grid gap-3">
              {reservationData.viewModel.items.map((reservation) => (
                <ReservationRow key={reservation.id} reservation={reservation} />
              ))}
            </div>

            <Pagination
              filter={filter}
              page={reservationData.viewModel.page}
              totalPages={reservationData.viewModel.totalPages}
            />
          </>
        ) : null}
      </section>
    </main>
  )
}

function EmptyReservationState({
  filter,
  page,
  totalCount,
  totalPages,
}: Readonly<{
  filter: ReservationFilter
  page: number
  totalCount: number
  totalPages: number
}>) {
  const isOutOfRange = totalCount > 0 && page > totalPages
  const isFiltered = filter !== "all"
  const title = isOutOfRange
    ? "예약 목록 페이지를 다시 선택해요"
    : isFiltered
      ? "이 상태의 예약이 없어요"
      : "아직 예약이 없어요"
  const description = isOutOfRange
    ? "요청한 페이지에 표시할 예약이 없어요. 첫 페이지에서 다시 확인해요."
    : isFiltered
      ? "다른 상태를 선택하거나 전체 예약에서 다시 확인해요."
      : "가까운 레슨을 찾아 첫 예약을 시작해 봐요."
  const href = isOutOfRange ? pageHref(filter, 1) : isFiltered ? "/mypage/reservations" : "/lessons"
  const action = isOutOfRange ? "첫 페이지 보기" : isFiltered ? "전체 보기" : "레슨 찾기"

  return (
    <section className="grid min-h-64 place-items-center rounded-[var(--radius-xl)] border border-line bg-subtle p-8 text-center">
      <div className="grid max-w-[420px] gap-3">
        <CalendarDays aria-hidden="true" className="mx-auto size-7 text-accent" strokeWidth={1.8} />
        <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">{title}</h2>
        <p className="m-0 text-sm leading-[1.6] text-secondary">{description}</p>
        <Link
          className="mx-auto inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          href={href}
        >
          {action}
        </Link>
      </div>
    </section>
  )
}

function ReservationRow({ reservation }: Readonly<{ reservation: ReservationSummaryView }>) {
  return (
    <article className="grid gap-4 rounded-[var(--radius-lg)] border border-line bg-canvas p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={reservation.status.tone}>{reservation.status.label}</StatusBadge>
          <span className="text-sm font-bold text-secondary">{reservation.paymentSummary}</span>
          {reservation.refundSummary ? (
            <span className="text-sm text-secondary">{reservation.refundSummary}</span>
          ) : null}
        </div>
        <h3 className="m-0 text-[22px] font-bold leading-[1.36] text-primary">
          {reservation.lessonTitle}
        </h3>
        <div className="grid gap-2 text-sm leading-[1.6] text-secondary md:grid-cols-2">
          <span className="inline-flex min-w-0 items-start gap-2">
            <CalendarDays
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            {reservation.scheduleLabel}
          </span>
          <span className="inline-flex min-w-0 items-start gap-2">
            <MapPin
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            {reservation.location}
          </span>
          <span className="inline-flex items-center gap-2 font-bold text-primary">
            <ReceiptText aria-hidden="true" className="size-4 text-accent" strokeWidth={1.8} />
            {reservation.amountText}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 lg:max-w-52 lg:justify-end">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-md)] border border-line bg-canvas px-4 py-2 text-sm font-bold text-primary hover:bg-inset"
          href={`/mypage/reservations/${reservation.id}`}
        >
          상세 보기
        </Link>
        {reservation.canContinuePayment ? (
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-4 py-2 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
            href={`/reservations/${reservation.id}/payment`}
          >
            결제 계속
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
        ) : null}
      </div>
    </article>
  )
}

function Pagination({
  filter,
  page,
  totalPages,
}: Readonly<{ filter: ReservationFilter; page: number; totalPages: number }>) {
  if (totalPages <= 1) return null

  return (
    <nav aria-label="예약 목록 페이지" className="flex items-center justify-center gap-3 pt-3">
      {page > 1 ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line bg-canvas px-4 text-sm font-bold text-primary hover:bg-inset"
          href={pageHref(filter, page - 1)}
        >
          이전
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-inset px-4 text-sm font-bold text-tertiary">
          이전
        </span>
      )}
      <span className="text-sm font-bold text-secondary">
        {page} / {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] border border-line bg-canvas px-4 text-sm font-bold text-primary hover:bg-inset"
          href={pageHref(filter, page + 1)}
        >
          다음
        </Link>
      ) : (
        <span className="inline-flex min-h-10 items-center rounded-[var(--radius-md)] bg-inset px-4 text-sm font-bold text-tertiary">
          다음
        </span>
      )}
    </nav>
  )
}

function filterHref(filter: ReservationFilter) {
  return filter === "all" ? "/mypage/reservations" : `/mypage/reservations?status=${filter}`
}

function pageHref(filter: ReservationFilter, page: number) {
  const params = new URLSearchParams()
  if (filter !== "all") params.set("status", filter)
  params.set("page", String(page))
  return `/mypage/reservations?${params.toString()}`
}
