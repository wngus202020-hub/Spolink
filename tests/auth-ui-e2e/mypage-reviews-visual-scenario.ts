import { expect, type Page, type TestInfo } from "@playwright/test"
import type { ReviewSession } from "./mypage-reviews-assertions"
import { activateReviewSession } from "./mypage-reviews-assertions"
import {
  acquireReviewSelectLock,
  hiddenReason,
  inactiveLessonTitle,
  restoreAuthenticatedReviewSelect,
  revokeAuthenticatedReviewSelect,
} from "./mypage-reviews-fixtures"
import {
  captureMypageReviewsVisual,
  prepareMypageReviewsVisualPage,
} from "./mypage-reviews-visual-dom"

type VisualScenarioInput = Readonly<{
  empty: ReviewSession
  markGrantRestored: () => void
  markInjectedFailure: () => void
  markLockReleased: () => void
  onCapture: (observation: object) => void
  ownerA: ReviewSession
  page: Page
  testInfo: TestInfo
}>

const projectViewport: Readonly<Record<string, Readonly<{ height: number; width: number }>>> = {
  "desktop-chromium": { height: 800, width: 1280 },
  "mobile-chromium": { height: 844, width: 390 },
  "tablet-chromium": { height: 1024, width: 768 },
}

export async function runMypageReviewsVisualScenario(input: VisualScenarioInput): Promise<void> {
  const viewport = projectViewport[input.testInfo.project.name]
  if (!viewport) throw new Error(`Unexpected review visual project: ${input.testInfo.project.name}`)
  await activateReviewSession(input.page, input.ownerA)
  await input.page.goto("/mypage/reviews")
  const content = await assertMixedPopulatedPage(input.page)
  for (const theme of ["light", "dark"] as const) {
    input.onCapture(
      await captureMypageReviewsVisual({
        content,
        ...viewport,
        name: `reviews-populated-${theme}-${viewport.width}.png`,
        page: input.page,
        recovery: null,
        state: "populated",
        theme,
      }),
    )
  }

  if (viewport.width === 390) {
    await captureEmpty(input, viewport)
    await captureLoading(input, viewport)
  }
  await captureReadFailure(input, viewport)
}

async function assertMixedPopulatedPage(page: Page): Promise<Record<string, true>> {
  const history = page.getByRole("region", { name: "리뷰 내역" })
  await expect(history.getByRole("listitem")).toHaveCount(20)
  await expect(history.getByText("A 리뷰 18", { exact: true })).toBeVisible()
  await expect(history.getByText(hiddenReason, { exact: true })).toBeVisible()
  await expect(history.getByText("작성한 내용이 없습니다.", { exact: true })).toBeVisible()
  await expect(history.getByText(inactiveLessonTitle, { exact: true })).toBeVisible()
  await expect(history.getByRole("link", { name: inactiveLessonTitle })).toHaveCount(0)
  await expect(history.getByRole("link", { name: "리뷰 내역 활성 레슨" }).first()).toBeVisible()
  await expect(history.getByText("공개 중", { exact: true }).first()).toBeVisible()
  await expect(history.getByText("숨김", { exact: true })).toBeVisible()
  await expect(history.getByRole("img", { name: "5점 만점에 5점" }).first()).toBeVisible()
  await expect(history.locator("time").first()).toContainText(/2026/u)
  await expect(history.getByRole("link", { name: "다음" })).toBeVisible()
  await expect(history.getByRole("link", { name: "이전" })).toHaveCount(0)
  return {
    ctaAbsence: true,
    ctaPresence: true,
    dateSemantics: true,
    hiddenOwnerReason: true,
    nullableFallback: true,
    pagination: true,
    starSemantics: true,
    statusSemantics: true,
    unavailableLesson: true,
    visibleRow: true,
  }
}

async function captureEmpty(
  input: VisualScenarioInput,
  viewport: Readonly<{ height: number; width: number }>,
): Promise<void> {
  await activateReviewSession(input.page, input.empty)
  await input.page.goto("/mypage/reviews")
  await expect(input.page.getByRole("heading", { name: "아직 작성한 리뷰가 없어요" })).toBeVisible()
  await expect(input.page.getByRole("link", { name: "예약 내역 보기" })).toBeVisible()
  input.onCapture(
    await captureMypageReviewsVisual({
      content: null,
      ...viewport,
      name: "reviews-empty-390.png",
      page: input.page,
      recovery: { emptyState: true },
      state: "empty",
      theme: "light",
    }),
  )
}

async function captureLoading(
  input: VisualScenarioInput,
  viewport: Readonly<{ height: number; width: number }>,
): Promise<void> {
  await activateReviewSession(input.page, input.ownerA)
  await input.page.goto("/mypage")
  await prepareMypageReviewsVisualPage({ ...viewport, page: input.page, theme: "light" })
  const reviewsLink = input.page.getByRole("link", { name: "리뷰 관리로 이동" })
  await expect(reviewsLink).toBeVisible()
  const release = await acquireReviewSelectLock()
  const navigation = reviewsLink.click()
  try {
    const loading = input.page.locator('main[aria-busy="true"]')
    await expect(loading).toBeVisible()
    await expect(input.page.getByText("리뷰 내역을 불러오지 못했어요")).toHaveCount(0)
    input.onCapture(
      await captureMypageReviewsVisual({
        content: null,
        ...viewport,
        name: "reviews-loading-390.png",
        page: input.page,
        prepared: true,
        recovery: {
          ariaBusyObserved: true,
          distinctFromReadFailure: true,
          externalDbLock: true,
          navigationStartedBeforeAwait: true,
        },
        state: "loading",
        theme: "light",
      }),
    )
  } finally {
    await release()
    input.markLockReleased()
    await navigation
    await expect(input.page).toHaveURL(/\/mypage\/reviews$/u)
  }
}

async function captureReadFailure(
  input: VisualScenarioInput,
  viewport: Readonly<{ height: number; width: number }>,
): Promise<void> {
  await revokeAuthenticatedReviewSelect()
  try {
    await activateReviewSession(input.page, input.ownerA)
    await input.page.goto("/mypage/reviews")
    await expect(
      input.page.getByRole("heading", { name: "리뷰 내역을 불러오지 못했어요" }),
    ).toBeVisible()
    if (viewport.width === 1280) {
      input.onCapture(
        await captureMypageReviewsVisual({
          content: null,
          ...viewport,
          name: "reviews-read-failure-1280.png",
          page: input.page,
          recovery: { realGrantRevoke: true, recoveryUi: true },
          state: "read-failure",
          theme: "light",
        }),
      )
      if (process.env["SPOLINK_MYPAGE_REVIEWS_INJECT_VISUAL_FAILURE"] === "1") {
        input.markInjectedFailure()
        await expect(input.page.getByText("의도적으로 존재하지 않는 시각 검증 대상")).toBeVisible()
      }
    }
  } finally {
    await restoreAuthenticatedReviewSelect()
    input.markGrantRestored()
  }
}
