export const learnerId = "00000000-0000-4000-8000-000000000001"
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const now = new Date("2026-08-01T00:00:00.000Z")

export const reservationStatuses = [
  "pending_payment",
  "confirmed",
  "completed",
  "cancelled_by_user",
  "cancelled_by_coach",
  "cancelled_by_admin",
  "no_show_user",
  "no_show_coach",
  "disputed",
]

export const paymentStatuses = [
  null,
  "ready",
  "paid",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
]

const terminalReservationStatuses = new Set([
  "completed",
  "cancelled_by_user",
  "cancelled_by_coach",
  "cancelled_by_admin",
  "no_show_user",
  "no_show_coach",
  "disputed",
])

export function expectedState(reservationStatus, paymentStatus) {
  if (terminalReservationStatuses.has(reservationStatus)) return "terminal"
  if (reservationStatus === "confirmed" && paymentStatus === "paid") return "complete"
  if (
    reservationStatus === "pending_payment" &&
    (paymentStatus === null || paymentStatus === "ready")
  ) {
    return "pending"
  }
  return "mismatch"
}

export function rawCompletionFields(viewModel) {
  return {
    endsAt: viewModel.endsAt,
    lessonId: viewModel.lessonId,
    paymentStatus: viewModel.paymentStatus,
    preparation: viewModel.preparation,
    reservationStatus: viewModel.reservationStatus,
    startsAt: viewModel.startsAt,
  }
}

export function completionSnapshot(overrides = {}) {
  const reservationStatus = overrides.reservationStatus ?? "confirmed"
  const paymentStatus = Object.hasOwn(overrides, "paymentStatus") ? overrides.paymentStatus : "paid"
  const paymentExpiresAt = overrides.paymentExpiresAt ?? "2026-08-01T00:10:00.000Z"
  const paymentProvider = overrides.paymentProvider ?? "toss"
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    kind: "found",
    lessons: [
      {
        address: "서울 강남구 테헤란로 1",
        cancellationPolicySummary: "수업 24시간 전까지 70% 환불",
        coachProfileId: "coach-1",
        id: "00000000-0000-4000-8000-000000000101",
        placeName: "강남 테니스장",
        preparation: "테니스화와 물을 준비해 주세요.",
        region: "서울 강남구",
        title: "입문 테니스 레슨",
      },
    ],
    payments:
      paymentStatus === null
        ? []
        : [{ amount: 50_000, provider: paymentProvider, reservationId, status: paymentStatus }],
    refunds: [],
    reservation: {
      coachProfileId: "coach-1",
      createdAt: "2026-07-30T00:00:00.000Z",
      id: reservationId,
      lessonId: "00000000-0000-4000-8000-000000000101",
      lessonScheduleId: "00000000-0000-4000-8000-000000000301",
      paymentExpiresAt,
      reservedPriceAmount: 50_000,
      status: reservationStatus,
    },
    schedules: [
      {
        endsAt: "2026-08-03T02:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000301",
        startsAt: "2026-08-03T01:00:00.000Z",
      },
    ],
  }
}

export function completionView(overrides = {}) {
  return {
    amountText: "50,000원",
    canContinuePayment: false,
    cancellation: {
      availableByStatus: true,
      estimatedRefundAmount: null,
      estimatedRefundText: "일정 정보가 없어 예상 환불액을 계산할 수 없어요.",
      storedPolicySummary: "수업 24시간 전까지 70% 환불",
    },
    coachName: "김코치",
    endsAt: "2026-08-03T02:00:00.000Z",
    id: reservationId,
    lessonId: "00000000-0000-4000-8000-000000000101",
    lessonTitle: "입문 테니스 레슨",
    location: "서울 강남구 · 강남 테니스장",
    paymentStatus: "paid",
    preparation: "테니스화와 물을 준비해 주세요.",
    paymentSummary: "결제 완료",
    refundSummary: null,
    reservationStatus: "confirmed",
    scheduleLabel: "2026. 8. 3. 오전 10:00 - 2026. 8. 3. 오전 11:00",
    startsAt: "2026-08-03T01:00:00.000Z",
    status: { label: "예약 확정", tone: "success" },
    ...overrides,
  }
}
