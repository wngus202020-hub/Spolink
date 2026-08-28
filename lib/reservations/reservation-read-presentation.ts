import type {
  PaymentSnapshot,
  PaymentStatus,
  RefundStatus,
  ReservationBadgeTone,
  ReservationFilter,
  ReservationSnapshot,
  ReservationStatus,
} from "./reservation-read-types"

export const RESERVATIONS_PER_PAGE = 20

export const RESERVATION_FILTERS: readonly Readonly<{
  label: string
  value: ReservationFilter
}>[] = [
  { label: "전체", value: "all" },
  { label: "결제 대기", value: "pending" },
  { label: "예약 확정", value: "confirmed" },
  { label: "완료", value: "completed" },
  { label: "취소", value: "cancelled" },
  { label: "노쇼", value: "no_show" },
  { label: "분쟁", value: "disputed" },
]

const statusPresentation: Record<
  ReservationStatus,
  Readonly<{ label: string; tone: ReservationBadgeTone }>
> = {
  cancelled_by_admin: { label: "관리자 취소", tone: "neutral" },
  cancelled_by_coach: { label: "지도자 취소", tone: "warning" },
  cancelled_by_user: { label: "학습자 취소", tone: "neutral" },
  completed: { label: "수업 완료", tone: "success" },
  confirmed: { label: "예약 확정", tone: "success" },
  disputed: { label: "분쟁 중", tone: "error" },
  no_show_coach: { label: "지도자 노쇼", tone: "warning" },
  no_show_user: { label: "학습자 노쇼", tone: "warning" },
  pending_payment: { label: "결제 대기", tone: "warning" },
}

const filterStatuses: Record<Exclude<ReservationFilter, "all">, readonly ReservationStatus[]> = {
  cancelled: ["cancelled_by_user", "cancelled_by_coach", "cancelled_by_admin"],
  completed: ["completed"],
  confirmed: ["confirmed"],
  disputed: ["disputed"],
  no_show: ["no_show_user", "no_show_coach"],
  pending: ["pending_payment"],
}

const paymentLabels: Record<PaymentStatus, string> = {
  cancelled: "결제 취소",
  failed: "결제 실패",
  paid: "결제 완료",
  partially_refunded: "부분 환불",
  ready: "결제 준비됨",
  refunded: "결제 환불됨",
}

export const refundLabels: Record<RefundStatus, string> = {
  approved: "승인",
  completed: "완료",
  failed: "실패",
  requested: "요청됨",
}

const scheduleFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
})

export function normalizeReservationFilter(
  value: string | string[] | undefined,
): ReservationFilter {
  const candidate = typeof value === "string" ? value : "all"
  return RESERVATION_FILTERS.find((filter) => filter.value === candidate)?.value ?? "all"
}

export function normalizeReservationPage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return 1
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

export function getReservationStatusPresentation(status: ReservationStatus) {
  return statusPresentation[status]
}

export function reservationStatusesForFilter(
  filter: ReservationFilter,
): readonly ReservationStatus[] | null {
  return filter === "all" ? null : filterStatuses[filter]
}

export function canContinueReservationPayment(
  reservation: Pick<ReservationSnapshot, "paymentExpiresAt" | "status">,
  payment: Pick<PaymentSnapshot, "provider" | "status"> | null,
  now: Date,
): boolean {
  if (reservation.status !== "pending_payment") return false
  const expiresAt = reservation.paymentExpiresAt
    ? new Date(reservation.paymentExpiresAt).getTime()
    : Number.NaN
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now.getTime())) return false
  if (expiresAt <= now.getTime()) return false
  return payment === null || (payment.status === "ready" && payment.provider === "toss")
}

export function formatPaymentSummary(
  reservation: ReservationSnapshot,
  payment: PaymentSnapshot | null,
  canContinuePayment: boolean,
  now: Date,
): string {
  if (reservation.status !== "pending_payment") {
    return payment ? paymentLabels[payment.status] : "결제 내역 없음"
  }
  if (canContinuePayment) return payment ? paymentLabels[payment.status] : "결제 준비 전"

  const expiresAt = reservation.paymentExpiresAt
    ? new Date(reservation.paymentExpiresAt).getTime()
    : Number.NaN
  if (Number.isFinite(expiresAt) && Number.isFinite(now.getTime()) && expiresAt <= now.getTime()) {
    return "결제 기한 만료"
  }
  return "결제 준비 불가"
}

export function formatScheduleLabel(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return "일정 정보 확인 필요"
  }
  return `${scheduleFormatter.format(start)} - ${scheduleFormatter.format(end)}`
}

export function formatLocation(region: string | null, place: string | null): string {
  if (region && place) return `${region} · ${place}`
  return region ?? place ?? "장소 정보 확인 필요"
}
