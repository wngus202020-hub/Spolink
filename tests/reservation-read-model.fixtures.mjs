export const learnerId = "00000000-0000-4000-8000-000000000001"
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const now = new Date("2026-08-01T00:00:00.000Z")

export function listSnapshot(overrides = {}) {
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    kind: "found",
    lessons: [lessonSnapshot()],
    payments: [paymentSnapshot()],
    refunds: [{ amount: 35_000, reservationId, status: "requested" }],
    reservations: [reservationSnapshot()],
    schedules: [scheduleSnapshot()],
    totalCount: 41,
    ...overrides,
  }
}

export function detailSnapshot(overrides = {}) {
  const reservationStatus = overrides.reservationStatus ?? "confirmed"
  return {
    coaches: [{ displayName: "김코치", id: "coach-1" }],
    kind: "found",
    lessons: [lessonSnapshot()],
    payments: [paymentSnapshot({ status: reservationStatus === "confirmed" ? "paid" : "ready" })],
    refunds: [],
    reservation: reservationSnapshot({ status: reservationStatus }),
    schedules: [scheduleSnapshot({ startsAt: overrides.scheduleStartsAt })],
  }
}

export function reservationSnapshot(overrides = {}) {
  return {
    coachProfileId: "coach-1",
    createdAt: "2026-07-30T00:00:00.000Z",
    id: reservationId,
    lessonId: "lesson-1",
    lessonScheduleId: "schedule-1",
    paymentExpiresAt: "2026-08-01T00:10:00.000Z",
    reservedPriceAmount: 50_000,
    status: "pending_payment",
    ...overrides,
  }
}

export function lessonSnapshot(overrides = {}) {
  return {
    address: "서울 강남구 테헤란로 1",
    cancellationPolicySummary: "수업 24시간 전까지 70% 환불",
    coachProfileId: "coach-1",
    id: "lesson-1",
    placeName: "강남 테니스장",
    preparation: "테니스화와 물을 준비해 주세요.",
    region: "서울 강남구",
    title: "입문 테니스 레슨",
    ...overrides,
  }
}

export function scheduleSnapshot(overrides = {}) {
  return {
    endsAt: "2026-08-03T02:00:00.000Z",
    id: "schedule-1",
    startsAt: "2026-08-03T01:00:00.000Z",
    ...overrides,
  }
}

export function paymentSnapshot(overrides = {}) {
  return {
    amount: 50_000,
    provider: "toss",
    reservationId,
    status: "ready",
    ...overrides,
  }
}

export function legacyDetailProjection(result) {
  if (result.viewModel === null) return result
  const viewModel = result.viewModel
  return {
    state: result.state,
    viewModel: {
      amountText: viewModel.amountText,
      canContinuePayment: viewModel.canContinuePayment,
      cancellation: viewModel.cancellation,
      coachName: viewModel.coachName,
      id: viewModel.id,
      lessonTitle: viewModel.lessonTitle,
      location: viewModel.location,
      paymentSummary: viewModel.paymentSummary,
      refundSummary: viewModel.refundSummary,
      scheduleLabel: viewModel.scheduleLabel,
      status: viewModel.status,
    },
  }
}
