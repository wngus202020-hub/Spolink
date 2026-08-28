import type {
  PaymentPageReadSnapshot,
  PaymentPageState,
  PaymentPageViewModel,
} from "./payment-page-types"

const scheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

export function buildPaymentPageViewModel(
  snapshot: Extract<PaymentPageReadSnapshot, { kind: "found" }>,
  state: PaymentPageState,
): PaymentPageViewModel {
  const { lesson, payment, reservation, schedule } = snapshot
  const readyPayment =
    state === "ready" && payment?.status === "ready" && payment.provider === "toss" && lesson
      ? {
          amount: payment.amount,
          orderName: lesson.title,
          paymentId: payment.id,
          provider: "toss" as const,
          providerOrderId: payment.providerOrderId,
        }
      : null

  return {
    amount: reservation.reservedPriceAmount,
    lesson: {
      id: lesson?.id ?? reservation.lessonId,
      title: lesson?.title ?? "레슨 정보 확인 필요",
    },
    paymentExpiresAt: reservation.paymentExpiresAt,
    place: lesson?.placeName ?? lesson?.address ?? null,
    readyPayment,
    refundSummary: lesson?.cancellationPolicySummary ?? null,
    region: lesson?.region ?? null,
    reservation: {
      id: reservation.id,
      status: reservation.status,
    },
    schedule: {
      endsAt: schedule?.endsAt ?? null,
      label: schedule ? formatScheduleLabel(schedule.startsAt, schedule.endsAt) : null,
      startsAt: schedule?.startsAt ?? null,
    },
  }
}

function formatScheduleLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null
  }

  return `${scheduleFormatter.format(start)} - ${scheduleFormatter.format(end)}`
}
