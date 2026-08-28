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
  loadCompletionPage,
  reservationPageCalls,
} from "./reservation-page-runtime.mjs"

const authenticated = { kind: "authenticated", profile: { id: learnerId } }
const params = Promise.resolve({ reservationId })

test("Given an unavailable account, when completion loads, then it routes through the protected gate", async (t) => {
  const completionModule = await loadCompletionPage()
  const CompletionPage = completionModule.default

  assert.equal(completionModule.dynamic, "force-dynamic")
  assert.equal(completionModule.revalidate, 0)

  for (const kind of ["unauthenticated", "unconfigured"]) {
    await t.test(kind, async () => {
      configureReservationPageRuntime({ auth: { kind } })
      const signal = await captureRouteSignal(() => CompletionPage({ params }))
      assert.deepEqual(signal, {
        destination: `/auth/login?next=${encodeURIComponent(`/reservations/${reservationId}/complete`)}`,
        kind: "redirect",
      })
      assert.deepEqual(reservationPageCalls().completion, [])
    })
  }
})

test("Given a profile-required account, when completion loads, then it routes to onboarding", async () => {
  const { default: CompletionPage } = await loadCompletionPage()
  configureReservationPageRuntime({ auth: { kind: "profile_required" } })

  const signal = await captureRouteSignal(() => CompletionPage({ params }))

  assert.deepEqual(signal, { destination: "/onboarding/profile", kind: "redirect" })
  assert.deepEqual(reservationPageCalls().completion, [])
})

test("Given an authoritative persisted state, when completion loads, then it chooses its destination", async (t) => {
  const { default: CompletionPage } = await loadCompletionPage()
  const scenarios = [
    ["not_found", { destination: null, kind: "not-found" }],
    ["pending", { destination: `/reservations/${reservationId}/payment`, kind: "redirect" }],
    ["terminal", { destination: `/mypage/reservations/${reservationId}`, kind: "redirect" }],
  ]

  for (const [state, expected] of scenarios) {
    await t.test(state, async () => {
      configureReservationPageRuntime({
        auth: authenticated,
        completion: { state, viewModel: null },
      })
      const signal = await captureRouteSignal(() => CompletionPage({ params }))
      assert.deepEqual(signal, expected)
      assert.deepEqual(reservationPageCalls().completion, [[reservationId, learnerId]])
    })
  }
})

test("Given a confirmed reservation, when completion renders, then success semantics and actions are exact", async () => {
  const { default: CompletionPage } = await loadCompletionPage()
  configureReservationPageRuntime({
    auth: authenticated,
    completion: { state: "complete", viewModel: completionView() },
  })

  const element = await CompletionPage({ params })

  await inspectRenderedHtml(element, async ({ page }) => {
    assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), [
      "예약이 완료됐어요",
    ])
    assert.deepEqual(await page.locator("dt").allTextContents(), [
      "레슨 일정 · KST",
      "장소",
      "지도자",
      "예약 금액",
      "결제 상태",
      "환불 상태",
      "준비물",
    ])
    assert.deepEqual(await readLinkContract(page), [
      { href: `/mypage/reservations/${reservationId}`, label: "예약 상세 보기" },
      {
        href: `/mypage/reservations/${reservationId}#cancellation-refund`,
        label: "취소·환불 안내",
      },
      { href: `/api/reservations/${reservationId}/calendar`, label: "캘린더 등록" },
      { href: "/mypage", label: "마이페이지" },
      { href: "/lessons/00000000-0000-4000-8000-000000000101", label: "레슨 더 보기" },
    ])
    assert.equal(await page.locator("a button, button a").count(), 0)
    assert.equal(await page.getByRole("button").count(), 0)
    assert.equal(await page.locator("a[href]:not([tabindex='-1'])").count(), 5)
    assert.equal(await page.locator("section[aria-labelledby='completion-title'] > nav").count(), 1)
    assert.equal(await page.locator("#cancellation-refund").count(), 0)
    assert.equal(await page.locator("form, [type=submit], a[href^='tel:']").count(), 0)
    assert.doesNotMatch(await page.locator("body").innerText(), /전화번호|인증 배지/iu)
    assert.equal(
      await page.locator("a[href*='/cancel'], a[href*='/no-show'], a[href$='/complete']").count(),
      0,
    )
  })
})

test("Given an untrusted completion state, when completion renders, then recovery stays non-identifying", async (t) => {
  const { default: CompletionPage } = await loadCompletionPage()

  for (const completion of [
    { state: "mismatch", viewModel: completionView() },
    { state: "read_failure", viewModel: null },
    { state: "complete", viewModel: null },
  ]) {
    await t.test(completion.state + (completion.viewModel ? "-with-data" : ""), async () => {
      configureReservationPageRuntime({ auth: authenticated, completion })
      const element = await CompletionPage({ params })

      await inspectRenderedHtml(element, async ({ page }) => {
        assert.equal(await page.getByRole("alert").count(), 1)
        assert.deepEqual(await page.getByRole("heading", { level: 1 }).allTextContents(), [
          "예약 완료 정보를 확인하지 못했어요",
        ])
        assert.deepEqual(await readLinkContract(page), [
          { href: `/reservations/${reservationId}/complete`, label: "다시 시도" },
          { href: "/mypage/reservations", label: "예약 목록" },
        ])
        assert.equal(await page.locator("a button, button a").count(), 0)
        assert.equal(await page.getByRole("button").count(), 0)
        assert.equal(await page.locator("a[href]:not([tabindex='-1'])").count(), 2)
        const text = await page.locator("body").innerText()
        assert.doesNotMatch(text, /예약 확정|결제 완료|입문 테니스 레슨|김코치/u)
        assert.equal(await page.locator("form, [type=submit], a[href^='tel:']").count(), 0)
      })
    })
  }
})
