import assert from "node:assert/strict"
import test from "node:test"
import {
  assertNoHorizontalOverflow,
  compileReviewUtilityCss,
  findElementByType,
  readElementRect,
} from "./mypage-reviews-ui-browser.mjs"
import {
  captureRouteSignal,
  configureRuntime,
  loadReviewsPage,
  runtime,
} from "./mypage-reviews-ui-runtime.mjs"
import { inspectRenderedHtml } from "./react-html-runtime.mjs"

test("Given unavailable account states, when the review page loads, then it redirects before the owner read", async (t) => {
  const Page = (await loadReviewsPage()).default
  for (const [auth, destination] of [
    [{ kind: "unauthenticated" }, "/auth/login?next=/mypage/reviews"],
    [{ kind: "unconfigured" }, "/auth/login?next=/mypage/reviews"],
    [{ kind: "profile_required" }, "/onboarding/profile"],
  ]) {
    await t.test(auth.kind, async () => {
      configureRuntime({ auth, data: { state: "read_failure", viewModel: null } })
      assert.equal(
        await captureRouteSignal(() => Page({ searchParams: Promise.resolve({}) })),
        destination,
      )
      assert.deepEqual(runtime.calls, [])
    })
  }
})

test("Given a ready account and malformed query array, when the review page renders, then it reads only the owner at page one", async () => {
  const pageModule = await loadReviewsPage()
  configureRuntime({
    data: { state: "empty", viewModel: { items: [], page: 1, totalCount: 0, totalPages: 1 } },
  })
  const element = await pageModule.default({ searchParams: Promise.resolve({ page: ["2", "3"] }) })
  assert.equal(pageModule.dynamic, "force-dynamic")
  assert.equal(pageModule.revalidate, 0)
  assert.deepEqual(runtime.calls, [["learner-ui-contract", 1]])
  await inspectRenderedHtml(element, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addStyleTag({ content: await compileReviewUtilityCss(page) })
    assert.equal(await page.locator("main").count(), 1)
    assert.equal(
      await page.getByRole("link", { name: "예약 내역 보기" }).getAttribute("href"),
      "/mypage/reservations",
    )
    const backLink = page.getByRole("link", { name: "마이페이지" })
    assert.equal(await backLink.getAttribute("href"), "/mypage")
    assert.ok((await readElementRect(backLink)).height >= 44)
    await assertNoHorizontalOverflow(page)
  })
})

test("Given out-of-range and read failures, when the page renders, then recovery states remain distinct and private", async () => {
  const Page = (await loadReviewsPage()).default
  configureRuntime({
    data: {
      state: "out_of_range",
      viewModel: { items: [], page: 9, totalCount: 21, totalPages: 2 },
    },
  })
  const outOfRange = await Page({ searchParams: Promise.resolve({ page: "9" }) })
  await inspectRenderedHtml(outOfRange, async ({ page }) => {
    assert.equal(
      await page.getByRole("link", { name: "첫 페이지 보기" }).getAttribute("href"),
      "/mypage/reviews",
    )
    assert.equal(await page.getByRole("alert").count(), 0)
  })
  configureRuntime({ data: { state: "read_failure", viewModel: null } })
  const failure = await Page({ searchParams: Promise.resolve({}) })
  await inspectRenderedHtml(failure, async ({ page }) => {
    assert.equal(await page.getByRole("alert").count(), 1)
    assert.equal(await page.locator("a[href*='/lessons/']").count(), 0)
    assert.doesNotMatch(await page.locator("body").innerText(), /visible-review|hidden-review/u)
  })
})

test("Given local loading and unexpected error boundaries, when keyboard users inspect them, then busy and reset controls are available", async () => {
  const [loadingModule, errorModule] = await Promise.all([
    import("../app/mypage/reviews/loading.tsx"),
    import("../app/mypage/reviews/error.tsx"),
  ])
  let resets = 0
  const errorElement = errorModule.default({
    reset: () => {
      resets += 1
    },
  })
  await inspectRenderedHtml(loadingModule.default(), async ({ page }) => {
    assert.equal(await page.locator("main[aria-busy='true']").count(), 1)
    await assertNoHorizontalOverflow(page)
  })
  await inspectRenderedHtml(errorElement, async ({ page }) => {
    const button = page.getByRole("button", { name: "다시 시도" })
    await button.focus()
    assert.equal(await button.evaluate((node) => document.activeElement === node), true)
    assert.equal(await page.getByRole("alert").count(), 1)
  })
  const resetButton = findElementByType(errorElement, "button")
  assert.notEqual(resetButton, null)
  resetButton.props.onClick()
  assert.equal(resets, 1)
})
