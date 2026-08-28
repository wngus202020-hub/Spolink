import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CircleAlert,
  CreditCard,
  MapPin,
  ReceiptText,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import {
  type ReservationDetailView,
  readReservationDetailData,
} from "@/lib/reservations/read-model"

type MyReservationDetailPageProps = Readonly<{
  params: Promise<{ reservationId: string }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

const refundRules = [
  "수업 시작 24시간 이상 전: 저장된 예약 금액의 70%",
  "수업 시작 3시간 이상 24시간 미만: 저장된 예약 금액의 50%",
  "수업 시작 3시간 미만: 환불액 0원",
] as const

export default async function MyReservationDetailPage({ params }: MyReservationDetailPageProps) {
  const [{ reservationId }, auth] = await Promise.all([params, readPageAuthProfile()])
  const nextPath = `/mypage/reservations/${reservationId}`
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=${nextPath}`)
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const reservationData = await readReservationDetailData(reservationId, auth.profile.id)
  if (reservationData.state === "not_found") {
    notFound()
  }

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1120px] gap-6 px-4 pb-14 pt-6 md:px-6 md:pt-10">
        <Link
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
          href="/mypage/reservations"
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          예약 목록
        </Link>

        {reservationData.state === "read_failure" ? (
          <section
            className="grid max-w-2xl gap-3 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)]"
            role="alert"
          >
            <CircleAlert
              aria-hidden="true"
              className="size-6 text-[var(--status-warning)]"
              strokeWidth={1.8}
            />
            <h1 className="m-0 text-[26px] font-bold leading-[1.28] text-primary">
              예약 정보를 불러오지 못했어요
            </h1>
            <p className="m-0 text-sm leading-[1.6] text-secondary">
              잠시 후 예약 목록에서 다시 열어 봐요.
            </p>
          </section>
        ) : null}

        {reservationData.state === "ready" && reservationData.viewModel ? (
          <ReservationDetails reservation={reservationData.viewModel} />
        ) : null}
      </section>
    </main>
  )
}

function ReservationDetails({ reservation }: Readonly<{ reservation: ReservationDetailView }>) {
  return (
    <>
      <div className="grid gap-3">
        <StatusBadge tone={reservation.status.tone}>{reservation.status.label}</StatusBadge>
        <h1 className="m-0 text-pretty text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
          {reservation.lessonTitle}
        </h1>
        <p className="m-0 max-w-[66ch] text-base leading-[1.7] text-secondary md:text-lg">
          예약 일정과 결제·환불 상태를 확인해요.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="grid gap-5">
          <section className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)] md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">예약 정보</h2>
              <StatusBadge tone={reservation.status.tone}>{reservation.status.label}</StatusBadge>
            </div>
            <dl className="m-0 grid gap-4 md:grid-cols-2">
              <DetailItem icon={CalendarDays} label="레슨 일정" value={reservation.scheduleLabel} />
              <DetailItem icon={MapPin} label="장소" value={reservation.location} />
              <DetailItem
                icon={UserRound}
                label="지도자"
                value={reservation.coachName ?? "지도자 정보 확인 필요"}
              />
              <DetailItem icon={ReceiptText} label="예약 금액" value={reservation.amountText} />
            </dl>
          </section>

          <section
            className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-subtle p-5 md:p-6"
            id="cancellation-refund"
          >
            <div className="inline-flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
              <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
                취소와 환불 안내
              </h2>
            </div>

            <div className="grid gap-2 text-sm leading-[1.65] text-secondary">
              <strong className="text-primary">
                {reservation.cancellation.availableByStatus
                  ? "현재 예약 상태는 취소 요청 대상이에요."
                  : "현재 예약 상태는 취소 요청 대상이 아니에요."}
              </strong>
              <span>{reservation.cancellation.estimatedRefundText}</span>
              <span>환불액은 저장된 예약 금액과 수업 시작 시각을 기준으로 서버에서 계산해요.</span>
            </div>

            <ul className="m-0 grid gap-2 border-t border-line pt-4 text-sm leading-[1.65] text-secondary">
              {refundRules.map((rule) => (
                <li className="ml-5" key={rule}>
                  {rule}
                </li>
              ))}
            </ul>

            {reservation.cancellation.storedPolicySummary ? (
              <p className="m-0 text-sm leading-[1.65] text-secondary">
                레슨 정책: {reservation.cancellation.storedPolicySummary}
              </p>
            ) : null}

            <p className="m-0 rounded-[var(--radius-md)] bg-canvas px-4 py-3 text-sm font-bold leading-[1.65] text-primary">
              이 화면에서는 취소 요청을 제출할 수 없어요.
            </p>
          </section>
        </div>

        <aside className="grid h-fit gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)] lg:sticky lg:top-6">
          <div className="grid gap-1">
            <span className="text-sm text-secondary">예약 금액</span>
            <strong className="text-3xl font-bold text-primary">{reservation.amountText}</strong>
            <span className="text-sm leading-[1.6] text-secondary">
              예약 시점에 저장된 금액이에요.
            </span>
          </div>

          <dl className="m-0 grid gap-3 border-t border-line pt-4 text-sm">
            <SummaryRow label="결제 상태" value={reservation.paymentSummary} />
            <SummaryRow label="환불 상태" value={reservation.refundSummary ?? "환불 내역 없음"} />
          </dl>

          {reservation.canContinuePayment ? (
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent px-5 py-3 text-sm font-bold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
              href={`/reservations/${reservation.id}/payment`}
            >
              결제 계속
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </Link>
          ) : (
            <p className="m-0 rounded-[var(--radius-md)] bg-inset px-4 py-3 text-sm leading-[1.6] text-secondary">
              현재 상태에서는 결제를 계속할 수 없어요.
            </p>
          )}

          {reservation.status.label === "수업 완료" ? (
            <Link
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-5 py-3 text-sm font-bold text-primary hover:bg-inset"
              href={`/mypage/reviews/new?reservationId=${reservation.id}`}
            >
              후기 남기기
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </Link>
          ) : null}

          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-line bg-canvas px-5 py-3 text-sm font-bold text-primary hover:bg-inset"
            href={`/mypage/trust-safety?targetType=reservation&targetId=${reservation.id}`}
          >
            예약 신고하기
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>

          <div className="inline-flex items-start gap-2 text-sm leading-[1.6] text-secondary">
            <CreditCard
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-accent"
              strokeWidth={1.8}
            />
            결제 계속은 유효한 결제 대기 예약에만 제공돼요.
          </div>
        </aside>
      </div>
    </>
  )
}

type DetailItemProps = Readonly<{
  icon: typeof CalendarDays
  label: string
  value: string
}>

function DetailItem({ icon: Icon, label, value }: DetailItemProps) {
  return (
    <div className="grid min-w-0 gap-2 border-t border-line pt-4">
      <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
        {label}
      </dt>
      <dd className="m-0 text-pretty text-sm leading-[1.6] text-secondary">{value}</dd>
    </div>
  )
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-secondary">{label}</dt>
      <dd className="m-0 text-right font-bold text-primary">{value}</dd>
    </div>
  )
}
