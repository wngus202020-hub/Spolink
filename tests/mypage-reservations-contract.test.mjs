import assert from "node:assert/strict"
import test from "node:test"
import { inspectRenderedHtml, readLinkContract } from "./react-html-runtime.mjs"
import {
  completionView,
  learnerId,
  reservationId,
} from "./reservation-completion-page-data.fixtures.mjs"
import {
  captureRouteSignal,
  configureReservationPageRuntime,
  loadMyReservationDetailPage,
  reservationPageCalls,
} from "./reservation-page-runtime.mjs"

const authenticated = { kind: "authenticated", profile: { id: learnerId } }
const params = Promise.resolve({ reservationId })

test("Given an unavailable account, when My Page detail loads, then it routes through the protected gate", async (t) => {
  const detailModule = await loadMyReservationDetailPage()
  const DetailPage = detailModule.default

  assert.equal(detailModule.dynamic, "force-dynamic")
  assert.equal(detailModule.revalidate, 0)

  for (const scenario of [
    ["unauthenticated", `/auth/login?next=/mypage/reservations/${reservationId}`],
    ["unconfigured", `/auth/login?next=/mypage/reservations/${reservationId}`],
    ["profile_required", "/onboarding/profile"],
  ]) {
    const [kind, destination] = scenario
    await t.test(kind, async () => {
      configureReservationPageRuntime({ auth: { kind } })
      const signal = await captureRouteSignal(() => DetailPage({ params }))
      assert.deepEqual(signal, { destination, kind: "redirect" })
      assert.deepEqual(reservationPageCalls().detail, [])
    })
  }
})

test("Given no learner-owned reservation, when My Page detail loads, then it returns not found", async () => {
  const { default: DetailPage } = await loadMyReservationDetailPage()
  configureReservationPageRuntime({
    auth: authenticated,
    detail: { state: "not_found", viewModel: null },
  })

  const signal = await captureRouteSignal(() => DetailPage({ params }))

  assert.deepEqual(signal, { destination: null, kind: "not-found" })
  assert.deepEqual(reservationPageCalls().detail, [[reservationId, learnerId]])
})

test("Given a learner-owned reservation, when My Page detail renders, then its accessible read contract is complete", async () => {
  const { default: DetailPage } = await loadMyReservationDetailPage()
  configureReservationPageRuntime({
    auth: authenticated,
    detail: { state: "ready", viewModel: completionView() },
  })

  const element = await DetailPage({ params })

  await inspectRenderedHtml(element, async ({ page }) => {
    assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), [
      "입문 테니스 레슨",
    ])
    assert.deepEqual(await page.locator("dt").allTextContents(), [
      "레슨 일정",
      "장소",
      "지도자",
      "예약 금액",
      "결제 상태",
      "환불 상태",
    ])
    assert.equal(await page.locator("#cancellation-refund").count(), 1)
    assert.match(await page.locator("#cancellation-refund").innerText(), /서버에서 계산/u)
    assert.match(await page.locator("#cancellation-refund").innerText(), /24시간 이상/u)
    assert.deepEqual(await readLinkContract(page), [
      { href: "/mypage/reservations", label: "예약 목록" },
      {
        href: `/mypage/trust-safety?targetType=reservation&targetId=${reservationId}`,
        label: "예약 신고하기",
      },
    ])
    assert.equal(await page.locator("form, [type=submit], a[href^='tel:']").count(), 0)
    assert.doesNotMatch(await page.locator("body").innerText(), /전화번호|인증 배지/iu)
    assert.equal(await page.locator("a[href*='/cancel'], a[href*='/payments/confirm']").count(), 0)
  })
})

test("Given a detail read failure, when My Page detail renders, then recovery is an alert without reservation data", async () => {
  const { default: DetailPage } = await loadMyReservationDetailPage()
  configureReservationPageRuntime({
    auth: authenticated,
    detail: { state: "read_failure", viewModel: null },
  })

  const element = await DetailPage({ params })

  await inspectRenderedHtml(element, async ({ page }) => {
    assert.equal(await page.getByRole("alert").count(), 1)
    assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), [
      "예약 정보를 불러오지 못했어요",
    ])
    assert.deepEqual(await readLinkContract(page), [
      { href: "/mypage/reservations", label: "예약 목록" },
    ])
    const text = await page.locator("body").innerText()
    assert.doesNotMatch(text, /입문 테니스 레슨|김코치|50,000원/u)
    assert.equal(await page.locator("form, [type=submit], a[href^='tel:']").count(), 0)
  })
})

test("Given a payable reservation, when My Page detail renders, then only the payment continuation link appears", async () => {
  const { default: DetailPage } = await loadMyReservationDetailPage()
  configureReservationPageRuntime({
    auth: authenticated,
    detail: {
      state: "ready",
      viewModel: completionView({ canContinuePayment: true, reservationStatus: "pending_payment" }),
    },
  })

  const element = await DetailPage({ params })

  await inspectRenderedHtml(element, async ({ page }) => {
    const paymentLink = page.getByRole("link", { name: "결제 계속" })
    assert.equal(await paymentLink.getAttribute("href"), `/reservations/${reservationId}/payment`)
    assert.equal(await page.locator("a[href*='/payments/confirm']").count(), 0)
  })
})
