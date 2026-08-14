import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  MapPin,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { PublicHeader } from "@/components/layout/public-header"
import { BookingRequestForm } from "@/components/lessons/booking-request-form"
import { StatusBadge } from "@/components/ui/status-badge"
import { readPageAuthProfile } from "@/lib/auth/page-auth"
import {
  getActiveLessonByIdForDisplay,
  getActiveLessonsForDisplay,
} from "@/lib/lessons/display-lessons"

type LessonBookingPageProps = Readonly<{
  params: Promise<{ lessonId: string }>
  searchParams: Promise<{ scheduleId?: string | string[] }>
}>

export const dynamic = "force-dynamic"
export const revalidate = 0

const refundRules = [
  "수업 시작까지 24시간 이상 70% 환불",
  "3시간 이상 24시간 미만 50% 환불",
  "3시간 미만 0% 환불",
] as const

export async function generateStaticParams() {
  const lessons = await getActiveLessonsForDisplay()

  return lessons.map((lesson) => ({ lessonId: lesson.id }))
}

export default async function LessonBookingPage({ params, searchParams }: LessonBookingPageProps) {
  const [{ lessonId }, { scheduleId }, auth] = await Promise.all([
    params,
    searchParams,
    readPageAuthProfile(),
  ])
  const selectedScheduleId = typeof scheduleId === "string" ? scheduleId : undefined
  const bookingPath = selectedScheduleId
    ? `/lessons/${lessonId}/booking?scheduleId=${selectedScheduleId}`
    : `/lessons/${lessonId}/booking`
  if (auth.kind === "unauthenticated" || auth.kind === "unconfigured") {
    redirect(`/auth/login?next=${bookingPath}`)
  }
  if (auth.kind === "profile_required") {
    redirect("/onboarding/profile")
  }

  const lesson = await getActiveLessonByIdForDisplay(lessonId)

  if (!lesson) {
    notFound()
  }

  const hasRequestedSchedule = scheduleId !== undefined
  const validSchedules = lesson.schedules.filter(
    (schedule) =>
      schedule.isOpen !== false &&
      (schedule.remainingCount === undefined || schedule.remainingCount > 0),
  )
  const selectedSchedule = hasRequestedSchedule
    ? validSchedules.find((schedule) => schedule.id === selectedScheduleId)
    : validSchedules[0]
  const detailHref = `/lessons/${lesson.id}`

  if (!selectedSchedule) {
    return (
      <main className="min-h-[100dvh]">
        <PublicHeader auth={auth} />

        <section className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-14 pt-6 md:px-6">
          <Link
            className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
            href={detailHref}
          >
            <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
            레슨 상세
          </Link>

          <section
            className="grid max-w-2xl gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)]"
            role="alert"
          >
            <div className="grid gap-2">
              <h1 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
                예약 가능한 일정을 다시 선택해요
              </h1>
              <p className="m-0 text-sm leading-[1.6] text-secondary">
                선택한 일정의 예약 가능 인원이 없어요. 다른 일정을 선택해요.
              </p>
            </div>
            <Link
              className="inline-flex min-h-11 w-fit items-center justify-center rounded-[var(--radius-md)] border border-line bg-canvas px-5 py-3 text-sm font-bold text-primary hover:bg-inset"
              href={detailHref}
            >
              다른 일정 선택
            </Link>
          </section>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-[100dvh]">
      <PublicHeader auth={auth} />

      <section className="mx-auto grid w-full max-w-[1180px] gap-6 px-4 pb-14 pt-6 md:px-6">
        <Link
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-canvas px-4 text-sm font-bold text-secondary hover:bg-inset"
          href={detailHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.8} />
          레슨 상세
        </Link>

        <div className="grid gap-3">
          <StatusBadge tone="warning">결제 전 확인</StatusBadge>
          <h1 className="m-0 text-[34px] font-bold leading-[1.18] text-primary md:text-5xl md:leading-[1.14]">
            예약 정보를 확인해요
          </h1>
          <p className="m-0 max-w-[68ch] text-base leading-[1.7] text-secondary md:text-lg">
            레슨, 일정, 장소, 환불 기준을 확인한 뒤 예약을 요청하고 결제 대기 단계로 이동해요.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div className="grid gap-5">
            <section className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-5 [box-shadow:var(--shadow-panel)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-2">
                  <span className="text-sm font-bold text-accent">{lesson.sport}</span>
                  <h2 className="m-0 text-[26px] font-bold leading-[1.28] text-primary">
                    {lesson.title}
                  </h2>
                  <p className="m-0 text-sm leading-[1.6] text-secondary">{lesson.summary}</p>
                </div>
                <StatusBadge tone="success">예약 가능</StatusBadge>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <InfoItem
                  icon={CalendarDays}
                  label="선택 일정"
                  value={`${selectedSchedule.label} · ${selectedSchedule.capacityText}`}
                />
                <InfoItem icon={MapPin} label="장소" value={lesson.venueText} />
                <InfoItem icon={ShieldCheck} label="지도자" value={lesson.coachName} />
                <InfoItem icon={CheckCircle2} label="준비물" value={lesson.preparationText} />
              </div>
            </section>

            <section className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-canvas p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">
                  예약자 정보
                </h2>
                <StatusBadge tone="success">예약자 확인</StatusBadge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <InfoItem icon={UserRound} label="예약자" value={auth.profile.display_name} />
                <InfoItem icon={CreditCard} label="예약 상태" value="결제 전 임시 단계" />
              </div>
            </section>

            <section className="grid gap-4 rounded-[var(--radius-xl)] border border-line bg-subtle p-5">
              <h2 className="m-0 text-[24px] font-bold leading-[1.3] text-primary">환불 기준</h2>
              <div className="grid gap-2">
                {refundRules.map((rule) => (
                  <div
                    className="flex min-h-12 items-center gap-3 rounded-[var(--radius-md)] bg-canvas px-4 py-3 text-sm font-bold text-secondary"
                    key={rule}
                  >
                    <CheckCircle2
                      aria-hidden="true"
                      className="size-4 text-[var(--status-success)]"
                      strokeWidth={1.8}
                    />
                    {rule}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="grid h-fit gap-5 rounded-[var(--radius-xl)] border border-line bg-canvas p-6 [box-shadow:var(--shadow-panel)] lg:sticky lg:top-6">
            <div className="grid gap-1">
              <span className="text-sm text-secondary">결제 예정 금액</span>
              <strong className="text-3xl font-bold text-primary">{lesson.priceText}</strong>
              <span className="text-sm text-secondary">{lesson.durationText} 1회 수업</span>
            </div>

            <div className="grid gap-3 border-t border-line pt-4 text-sm text-secondary">
              <PriceRow label="수업 금액" value={lesson.priceText} />
              <PriceRow label="플랫폼 수수료" value="포함" />
              <PriceRow isTotal={true} label="총 결제 예정" value={lesson.priceText} />
            </div>

            <BookingRequestForm
              lessonId={lesson.id}
              lessonScheduleId={selectedSchedule.id}
              priceText={lesson.priceText}
              returnPath={bookingPath}
            />

            <p className="m-0 grid gap-1 text-sm leading-[1.6] text-secondary">
              <span>학습자 취소는 남은 시간에 따라 70%, 50%, 0% 환불 기준이 적용돼요.</span>
              <span>결제 완료 전에는 예약이 완료되지 않아요.</span>
            </p>
          </aside>
        </div>
      </section>
    </main>
  )
}

type InfoItemProps = Readonly<{
  icon: typeof CalendarDays
  label: string
  value: string
}>

function InfoItem({ icon: Icon, label, value }: InfoItemProps) {
  return (
    <div className="grid gap-2 rounded-[var(--radius-lg)] border border-line bg-canvas p-4">
      <Icon aria-hidden="true" className="size-5 text-accent" strokeWidth={1.8} />
      <span className="text-sm font-bold text-primary">{label}</span>
      <span className="text-sm leading-[1.55] text-secondary">{value}</span>
    </div>
  )
}

type PriceRowProps = Readonly<{
  isTotal?: boolean
  label: string
  value: string
}>

function PriceRow({ isTotal = false, label, value }: PriceRowProps) {
  return (
    <span
      className={[
        "flex items-center justify-between gap-3",
        isTotal ? "text-base font-bold text-primary" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <strong className={isTotal ? "text-xl text-primary" : "text-primary"}>{value}</strong>
    </span>
  )
}
