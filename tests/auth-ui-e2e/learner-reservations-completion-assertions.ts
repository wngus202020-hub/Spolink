import { expect, type Page, type TestInfo } from "@playwright/test"
import {
  fixtureIds,
  ownedLessonTitle,
  reservationIds,
  visualCoachDisplayName,
} from "./learner-reservations-fixtures"
import {
  captureCompletionScreenshot,
  focusByKeyboard,
  type ScreenshotReceipt,
} from "./learner-reservations-visual-assertions"

type CompletionScenario = Readonly<{
  page: Page
  testInfo: TestInfo
}>

export async function assertCompletionSuccessSurface({
  page,
  testInfo,
}: CompletionScenario): Promise<ScreenshotReceipt> {
  const completionPath = `/reservations/${reservationIds.confirmed}/complete`
  const directResponse = await page.goto(completionPath, { waitUntil: "networkidle" })
  expect(directResponse?.status()).toBe(200)
  await expect(page.getByRole("heading", { level: 1, name: "예약이 완료됐어요" })).toBeVisible()
  await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
  await expect(page.getByText(visualCoachDisplayName, { exact: true })).toBeVisible()
  await expect(page.getByText("운동화와 물", { exact: true })).toBeVisible()
  await expect(page.locator("h1")).toHaveCount(1)
  const actions = {
    calendar: page.getByRole("link", { name: "캘린더 등록" }),
    detail: page.getByRole("link", { name: "예약 상세 보기" }),
    lesson: page.getByRole("link", { name: "레슨 더 보기" }),
    mypage: page.getByRole("link", { name: "마이페이지", exact: true }),
    refund: page.getByRole("link", { name: "취소·환불 안내", exact: true }),
  }
  await expect(actions.detail).toHaveAttribute(
    "href",
    `/mypage/reservations/${reservationIds.confirmed}`,
  )
  await expect(actions.refund).toHaveAttribute(
    "href",
    `/mypage/reservations/${reservationIds.confirmed}#cancellation-refund`,
  )
  await expect(actions.calendar).toHaveAttribute(
    "href",
    `/api/reservations/${reservationIds.confirmed}/calendar`,
  )
  await expect(actions.mypage).toHaveAttribute("href", "/mypage")
  await expect(actions.lesson).toHaveAttribute("href", `/lessons/${fixtureIds.lesson}`)
  await focusByKeyboard(page, actions.detail)
  return captureCompletionScreenshot({
    focusedAction: actions.detail,
    page,
    secondaryAction: actions.calendar,
    state: "success",
    testInfo,
  })
}

export async function assertCompletionPersistence(page: Page) {
  const completionPath = `/reservations/${reservationIds.confirmed}/complete`
  await page.reload({ waitUntil: "networkidle" })
  await expect(page).toHaveURL(completionPath)
  await expect(page.getByRole("heading", { level: 1, name: "예약이 완료됐어요" })).toBeVisible()
  await page.goto(`/reservations/${reservationIds.confirmed}/payment`)
  await expect(page).toHaveURL(completionPath)
  await expect(page.getByRole("heading", { level: 1, name: "예약이 완료됐어요" })).toBeVisible()
}

export async function assertNonSuccessCompletionRoutes(page: Page) {
  await page.goto(`/reservations/${reservationIds.pending}/complete`)
  await expect(page).toHaveURL(`/reservations/${reservationIds.pending}/payment`)
  await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()
  await page.goto(`/reservations/${reservationIds.completed}/complete`)
  await expect(page).toHaveURL(`/mypage/reservations/${reservationIds.completed}`)
  await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
}
