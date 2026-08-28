import assert from "node:assert/strict"

import { createReservationCalendarRouteHandler } from "../lib/reservations/calendar-route-handler.ts"

export const learnerId = "00000000-0000-4000-8000-000000000001"
export const reservationId = "00000000-0000-4000-8000-000000000401"
export const calendarBytes = new TextEncoder().encode("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
const generatedAt = new Date("2026-08-18T03:04:05.000Z")

export function createHarness(options = {}) {
  const calls = { auth: 0, build: [], mutation: 0, read: [], session: 0 }
  const completion = options.completion ?? { state: "complete", viewModel: completeView() }
  const user = Object.hasOwn(options, "user") ? options.user : { id: learnerId }

  const handler = createReservationCalendarRouteHandler({
    buildCalendar: (input) => {
      calls.build.push(input)
      if (options.buildError) throw options.buildError
      return calendarBytes
    },
    createSession: async (responseHeaders) => {
      calls.session += 1
      for (const cookie of options.responseCookies ?? ["sb-session=refreshed; Path=/; HttpOnly"]) {
        responseHeaders.append("Set-Cookie", cookie)
      }
      return {
        getVerifiedAuthUser: async () => {
          calls.auth += 1
          return user
        },
        readCompletion: async (...args) => {
          calls.read.push(args)
          return completion
        },
      }
    },
    getConfigStatus: () => ({ configured: options.configured ?? true }),
    getFilename: () => "spolink-reservation.ics",
    now: () => generatedAt,
  })

  return { calls, handler }
}

export function completeView(overrides = {}) {
  return {
    amountText: "55,000원",
    cancellation: {
      availableByStatus: true,
      estimatedRefundAmount: 55000,
      estimatedRefundText: "예상 환불액 55,000원",
      storedPolicySummary: null,
    },
    canContinuePayment: false,
    coachName: "김코치",
    endsAt: "2026-08-20T02:30:00.000Z",
    id: reservationId,
    lessonId: "00000000-0000-4000-8000-000000000101",
    lessonTitle: "한강 테니스 입문",
    location: "서울숲 테니스장 1번 코트",
    paymentStatus: "paid",
    paymentSummary: "결제 완료",
    preparation: "운동화와 물을 준비해 주세요.",
    refundSummary: null,
    reservationStatus: "confirmed",
    scheduleLabel: "2026. 8. 20. 오전 10:00 ~ 오전 11:30",
    startsAt: "2026-08-20T01:00:00.000Z",
    status: { label: "예약 확정", tone: "success" },
    ...overrides,
  }
}

export function assertRejectedWithoutCalendarWork(harness) {
  assert.equal(harness.calls.read.length, 0)
  assert.equal(harness.calls.build.length, 0)
}
