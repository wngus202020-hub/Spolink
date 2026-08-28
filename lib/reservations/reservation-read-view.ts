import {
  canContinueReservationPayment,
  formatLocation,
  formatPaymentSummary,
  formatScheduleLabel,
  getReservationStatusPresentation,
  refundLabels,
} from "./reservation-read-presentation"
import type {
  ReservationDetailReadSnapshot,
  ReservationDetailView,
  ReservationEnrichment,
  ReservationSnapshot,
  ReservationStatus,
  ReservationSummaryView,
} from "./reservation-read-types"

type CancellationInput = Readonly<{
  amount: number
  now: Date
  startsAt: string | null
  status: ReservationStatus
  storedPolicySummary: string | null
}>

export function buildReservationSummaryView(
  reservation: ReservationSnapshot,
  enrichment: ReservationEnrichment,
  now: Date,
): ReservationSummaryView {
  const lesson = enrichment.lessons.find((item) => item.id === reservation.lessonId)
  const schedule = enrichment.schedules.find((item) => item.id === reservation.lessonScheduleId)
  const payment = enrichment.payments.find((item) => item.reservationId === reservation.id) ?? null
  const refund = enrichment.refunds.find((item) => item.reservationId === reservation.id) ?? null
  const canContinuePayment = canContinueReservationPayment(reservation, payment, now)
  const paymentSummary =
    payment?.status === "refunded" && refund
      ? "결제 처리됨"
      : formatPaymentSummary(reservation, payment, canContinuePayment, now)

  return {
    amountText: `${reservation.reservedPriceAmount.toLocaleString("ko-KR")}원`,
    canContinuePayment,
    id: reservation.id,
    lessonTitle: lesson?.title ?? "레슨 정보 확인 필요",
    location: formatLocation(lesson?.region ?? null, lesson?.placeName ?? lesson?.address ?? null),
    paymentSummary,
    refundSummary: refund
      ? `환불 ${refund.amount.toLocaleString("ko-KR")}원 · ${refundLabels[refund.status]}`
      : null,
    scheduleLabel: schedule
      ? formatScheduleLabel(schedule.startsAt, schedule.endsAt)
      : "일정 정보 확인 필요",
    status: getReservationStatusPresentation(reservation.status),
  }
}

export function buildReservationDetailView(
  snapshot: Extract<ReservationDetailReadSnapshot, { kind: "found" }>,
  now: Date,
): ReservationDetailView {
  const reservation = snapshot.reservation
  const lesson = snapshot.lessons.find((item) => item.id === reservation.lessonId)
  const coach = snapshot.coaches.find((item) => item.id === reservation.coachProfileId)
  const schedule = snapshot.schedules.find((item) => item.id === reservation.lessonScheduleId)
  const payment = snapshot.payments.find((item) => item.reservationId === reservation.id)

  return {
    ...buildReservationSummaryView(reservation, snapshot, now),
    cancellation: deriveCancellationInfo({
      amount: reservation.reservedPriceAmount,
      now,
      startsAt: schedule?.startsAt ?? null,
      status: reservation.status,
      storedPolicySummary: lesson?.cancellationPolicySummary ?? null,
    }),
    coachName: coach?.displayName ?? null,
    endsAt: schedule?.endsAt ?? null,
    lessonId: reservation.lessonId,
    paymentStatus: payment?.status ?? null,
    preparation: lesson?.preparation ?? null,
    reservationStatus: reservation.status,
    startsAt: schedule?.startsAt ?? null,
  }
}

function deriveCancellationInfo(input: CancellationInput): ReservationDetailView["cancellation"] {
  if (input.status !== "pending_payment" && input.status !== "confirmed") {
    return {
      availableByStatus: false,
      estimatedRefundAmount: null,
      estimatedRefundText: "현재 예약 상태에서는 취소 요청 대상이 아니에요.",
      storedPolicySummary: input.storedPolicySummary,
    }
  }

  if (input.status === "pending_payment") {
    return {
      availableByStatus: true,
      estimatedRefundAmount: 0,
      estimatedRefundText: "결제 전 예약으로 환불 대상 결제액이 없어요.",
      storedPolicySummary: input.storedPolicySummary,
    }
  }

  const scheduleTime = input.startsAt ? new Date(input.startsAt).getTime() : Number.NaN
  if (!Number.isFinite(scheduleTime) || !Number.isFinite(input.now.getTime())) {
    return {
      availableByStatus: true,
      estimatedRefundAmount: null,
      estimatedRefundText: "일정 정보가 없어 예상 환불액을 계산할 수 없어요.",
      storedPolicySummary: input.storedPolicySummary,
    }
  }

  const remainingMilliseconds = scheduleTime - input.now.getTime()
  const ratio =
    remainingMilliseconds >= 24 * 60 * 60 * 1000
      ? 0.7
      : remainingMilliseconds >= 3 * 60 * 60 * 1000
        ? 0.5
        : 0
  const estimatedRefundAmount = Math.floor(input.amount * ratio)

  return {
    availableByStatus: true,
    estimatedRefundAmount,
    estimatedRefundText: `현재 시각 기준 예상 환불액 ${estimatedRefundAmount.toLocaleString("ko-KR")}원`,
    storedPolicySummary: input.storedPolicySummary,
  }
}
