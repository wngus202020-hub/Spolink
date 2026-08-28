import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  CircleAlert,
  MapPin,
  ReceiptText,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { buttonClassName } from "@/components/ui/button"
import type { ReservationDetailView } from "@/lib/reservations/read-model"

type ReservationCompletionViewProps = Readonly<{
  reservation: ReservationDetailView
}>

export function ReservationCompletionView({ reservation }: ReservationCompletionViewProps) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-12 pt-6 md:gap-12 md:px-6 md:pt-8">
      <section aria-labelledby="completion-title" className="grid max-w-3xl gap-6">
        <div className="grid gap-3">
          <CheckCircle2
            aria-hidden="true"
            className="size-10 text-[var(--status-success)] md:size-12"
            strokeWidth={1.6}
          />
          <div className="grid gap-2">
            <p className="m-0 text-sm font-bold text-[var(--status-success)]">예약 확정</p>
            <h1
              className="m-0 text-pretty text-4xl font-bold leading-tight text-primary md:text-5xl"
              id="completion-title"
            >
              예약이 완료됐어요
            </h1>
            <p className="m-0 max-w-2xl text-lg leading-relaxed text-secondary">
              결제와 예약 상태를 확인했어요. 아래 일정과 준비 안내를 확인해 주세요.
            </p>
          </div>
        </div>

        <nav aria-label="예약 완료 후 이동" className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Link
            className={buttonClassName(
              "primary",
              "col-span-2 w-full whitespace-nowrap md:col-span-2",
            )}
            href={`/mypage/reservations/${reservation.id}`}
          >
            예약 상세 보기
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </Link>
          <Link
            className={buttonClassName("outline", "w-full whitespace-nowrap md:col-span-2")}
            href={`/mypage/reservations/${reservation.id}#cancellation-refund`}
          >
            취소·환불 안내
          </Link>
          <Link
            className={buttonClassName("secondary", "w-full whitespace-nowrap md:col-span-2")}
            href={`/api/reservations/${reservation.id}/calendar`}
          >
            <CalendarPlus aria-hidden="true" className="size-4" strokeWidth={1.8} />
            캘린더 등록
          </Link>
          <Link
            className={buttonClassName("ghost", "w-full whitespace-nowrap md:col-span-3")}
            href="/mypage"
          >
            마이페이지
          </Link>
          <Link
            className={buttonClassName("ghost", "w-full whitespace-nowrap md:col-span-3")}
            href={`/lessons/${reservation.lessonId}`}
          >
            레슨 더 보기
          </Link>
        </nav>
      </section>

      <section
        aria-labelledby="reservation-summary-title"
        className="grid gap-6 border-t border-line pt-8"
      >
        <div className="grid gap-2">
          <p className="m-0 text-sm font-bold text-accent">레슨</p>
          <h2
            className="m-0 text-pretty text-3xl font-bold leading-tight text-primary"
            id="reservation-summary-title"
          >
            {reservation.lessonTitle}
          </h2>
        </div>

        <dl className="m-0 grid gap-x-8 gap-y-5 md:grid-cols-2">
          <SummaryItem
            icon={CalendarDays}
            label="레슨 일정 · KST"
            value={reservation.scheduleLabel}
          />
          <SummaryItem icon={MapPin} label="장소" value={reservation.location} />
          <SummaryItem
            icon={UserRound}
            label="지도자"
            value={reservation.coachName ?? "지도자 정보 확인 필요"}
          />
          <SummaryItem icon={ReceiptText} label="예약 금액" value={reservation.amountText} />
          <SummaryItem icon={ShieldCheck} label="결제 상태" value={reservation.paymentSummary} />
          <SummaryItem
            icon={ReceiptText}
            label="환불 상태"
            value={reservation.refundSummary ?? "환불 내역 없음"}
          />
        </dl>
      </section>

      <section
        aria-labelledby="completion-guidance-title"
        className="grid gap-5 border-t border-line pt-8 md:grid-cols-2"
      >
        <div className="grid content-start gap-3">
          <h2
            className="m-0 text-3xl font-bold leading-tight text-primary"
            id="completion-guidance-title"
          >
            레슨 전 확인해 주세요
          </h2>
          <dl className="m-0 grid gap-2">
            <dt className="text-sm font-bold text-primary">준비물</dt>
            <dd className="m-0 text-sm leading-normal text-secondary">
              {reservation.preparation ?? "별도 준비물 안내가 없어요."}
            </dd>
          </dl>
        </div>

        <div className="grid content-start gap-3 bg-subtle p-5">
          <div className="inline-flex items-center gap-2 text-primary">
            <ShieldCheck aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
            <strong>취소·환불 안내</strong>
          </div>
          <p className="m-0 text-sm leading-normal text-secondary">
            취소 가능 여부와 예상 환불액은 예약 상세에서 현재 수업 시각을 기준으로 확인할 수 있어요.
          </p>
        </div>
      </section>
    </div>
  )
}

type SummaryItemProps = Readonly<{
  icon: typeof CalendarDays
  label: string
  value: string
}>

function SummaryItem({ icon: Icon, label, value }: SummaryItemProps) {
  return (
    <div className="grid min-w-0 gap-2 border-t border-line pt-4">
      <dt className="inline-flex items-center gap-2 text-sm font-bold text-primary">
        <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
        {label}
      </dt>
      <dd className="m-0 text-pretty text-sm leading-normal text-secondary">{value}</dd>
    </div>
  )
}

export function ReservationCompletionRecovery({ retryHref }: Readonly<{ retryHref: string }>) {
  return (
    <section
      aria-labelledby="completion-recovery-title"
      className="mx-auto grid w-full max-w-3xl gap-5 px-4 py-12 md:px-6 md:py-16"
      role="alert"
    >
      <CircleAlert
        aria-hidden="true"
        className="size-8 text-[var(--status-warning)]"
        strokeWidth={1.8}
      />
      <div className="grid gap-3">
        <h1
          className="m-0 text-pretty text-4xl font-bold leading-tight text-primary"
          id="completion-recovery-title"
        >
          예약 완료 정보를 <span className="whitespace-nowrap">확인하지 못했어요</span>
        </h1>
        <p className="m-0 text-lg leading-relaxed text-secondary">
          잠시 후 다시 확인하거나 예약 목록에서 현재 상태를 확인해 주세요.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          className={buttonClassName("primary", "w-full whitespace-nowrap sm:min-w-36")}
          href={retryHref}
        >
          다시 시도
        </Link>
        <Link
          className={buttonClassName("outline", "w-full whitespace-nowrap sm:min-w-36")}
          href="/mypage/reservations"
        >
          예약 목록
        </Link>
      </div>
    </section>
  )
}
