import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { installPaymentPageModuleResolver } from "./payment-page-module-resolver.mjs"

installPaymentPageModuleResolver()

const { createReservationPaymentPage } = await import(
  "../app/reservations/[reservationId]/payment/payment-page-runtime.tsx"
)

const reservationId = "reservation-contract-id"
const learnerId = "learner-contract-id"

test("payment page redirects unauthenticated and profile-required accounts before reading data", async () => {
  for (const [auth, expectedPath] of [
    [{ kind: "unauthenticated" }, `/auth/login?next=/reservations/${reservationId}/payment`],
    [{ kind: "unconfigured" }, `/auth/login?next=/reservations/${reservationId}/payment`],
    [{ kind: "profile_required", userId: learnerId }, "/onboarding/profile"],
  ]) {
    const reads = []
    const page = createTestPage(auth, async (...args) => {
      reads.push(args)
      return paymentData("pending_valid")
    })

    await assert.rejects(runPage(page), redirectTo(expectedPath))
    assert.deepEqual(reads, [])
  }
})

test("payment page reads with the authenticated learner and redirects only confirmed state", async () => {
  const reads = []
  const page = createTestPage(readyAuth(), async (...args) => {
    reads.push(args)
    return paymentData("confirmed")
  })

  await assert.rejects(runPage(page), redirectTo(`/reservations/${reservationId}/complete`))
  assert.deepEqual(reads, [[reservationId, learnerId]])
})

test("pending payment page renders navigation, reservation labels, and a preparation form", async () => {
  const page = createTestPage(readyAuth(), async () => paymentData("pending_valid"))
  const markup = renderToStaticMarkup(await runPage(page))

  assert.match(markup, /href="\/lessons"/)
  for (const label of [
    "결제 준비 전",
    "예약 레슨",
    "레슨 일정",
    "장소",
    "결제 준비 기한",
    "예약 금액",
    "환불 기준",
  ]) {
    assert.match(markup, new RegExp(label))
  }
  assert.match(markup, /<form[^>]*method="post"/)
  assert.match(markup, /결제 요청 준비/)
})

test("unavailable and terminal payment pages render recovery state without a preparation form", async () => {
  for (const [state, title] of [
    ["unavailable", "지금은 결제를 준비할 수 없어요"],
    ["terminal", "결제를 준비할 수 없는 예약이에요"],
  ]) {
    const page = createTestPage(readyAuth(), async () => paymentData(state))
    const markup = renderToStaticMarkup(await runPage(page))

    assert.match(markup, new RegExp(title))
    assert.match(markup, /현재 상태에서는 결제 요청을 준비할 수 없어요/)
    assert.doesNotMatch(markup, /<form/)
    assert.doesNotMatch(markup, /결제 완료|예약 확정/)
  }
})

function createTestPage(auth, readData) {
  return createReservationPaymentPage({
    readAuth: async () => auth,
    readData,
    redirectTo(path) {
      throw new RedirectSignal(path)
    },
  })
}

function runPage(page) {
  return page({ params: Promise.resolve({ reservationId }) })
}

function redirectTo(path) {
  return (error) => error instanceof RedirectSignal && error.path === path
}

class RedirectSignal extends Error {
  constructor(path) {
    super(path)
    this.path = path
  }
}

function readyAuth() {
  return { coachProfile: null, kind: "ready", profile: { display_name: "학습자", id: learnerId } }
}

function paymentData(state) {
  return { state, viewModel: state === "confirmed" ? null : paymentViewModel() }
}

function paymentViewModel() {
  return {
    amount: 50_000,
    lesson: { id: "lesson-contract-id", title: "입문 테니스 레슨" },
    paymentExpiresAt: "2026-08-01T00:10:00.000Z",
    place: "강남 테니스장",
    readyPayment: null,
    refundSummary: "수업 24시간 전까지 70% 환불",
    region: "서울 강남구",
    reservation: { id: reservationId, status: "pending_payment" },
    schedule: { endsAt: null, label: "2026. 8. 3. 오전 10:00", startsAt: null },
  }
}
