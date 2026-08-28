export const now = new Date("2026-08-01T00:00:00.000Z")
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const learnerId = "00000000-0000-4000-8000-000000000001"

export function foundSnapshot(overrides = {}) {
  const reservationOverrides = overrides.reservation ?? {}
  const snapshot = {
    kind: "found",
    lesson: {
      address: "서울 강남구 테헤란로 1",
      cancellationPolicySummary: "수업 24시간 전까지 70% 환불",
      id: "00000000-0000-4000-8000-000000000101",
      placeName: "강남 테니스장",
      region: "서울 강남구",
      title: "입문 테니스 레슨",
    },
    payment: null,
    reservation: {
      id: reservationId,
      learnerId,
      lessonId: "00000000-0000-4000-8000-000000000101",
      lessonScheduleId: "00000000-0000-4000-8000-000000000301",
      paymentExpiresAt: "2026-08-01T00:10:00.000Z",
      reservedPriceAmount: 50_000,
      status: "pending_payment",
      ...reservationOverrides,
    },
    schedule: {
      endsAt: "2026-08-03T02:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000301",
      startsAt: "2026-08-03T01:00:00.000Z",
    },
  }

  return {
    ...snapshot,
    ...overrides,
    reservation: snapshot.reservation,
  }
}

export function paymentSnapshot(overrides = {}) {
  return {
    amount: 50_000,
    id: "00000000-0000-4000-8000-000000000501",
    provider: "toss",
    providerOrderId: `spolink_${reservationId}`,
    status: "ready",
    ...overrides,
  }
}
