import { expect, type Page, type TestInfo } from "@playwright/test"
import { foreignLessonTitle, reservationIds } from "./learner-reservations-fixtures"
import {
  captureCompletionScreenshot,
  focusByKeyboard,
  type ScreenshotReceipt,
} from "./learner-reservations-visual-assertions"

type RecoveryScenario = Readonly<{
  page: Page
  testInfo: TestInfo
}>

export async function assertCompletionRecoverySurface({
  page,
  testInfo,
}: RecoveryScenario): Promise<ScreenshotReceipt> {
  const mismatchPath = `/reservations/${reservationIds.mismatch}/complete`
  const mismatchResponse = await page.goto(mismatchPath, { waitUntil: "networkidle" })
  expect(mismatchResponse?.status()).toBe(200)
  await expect(
    page.getByRole("heading", { level: 1, name: "예약 완료 정보를 확인하지 못했어요" }),
  ).toBeVisible()
  await expect(
    page.getByRole("alert", { name: "예약 완료 정보를 확인하지 못했어요" }),
  ).toBeVisible()
  await expect(page.locator("h1")).toHaveCount(1)
  const retryAction = page.getByRole("link", { name: "다시 시도" })
  const reservationListAction = page.getByRole("link", { name: "예약 목록" })
  await expect(retryAction).toHaveAttribute("href", mismatchPath)
  await expect(reservationListAction).toHaveAttribute("href", "/mypage/reservations")
  await expect(page.getByText("예약이 완료됐어요")).toHaveCount(0)
  await focusByKeyboard(page, retryAction)
  const screenshot = await captureCompletionScreenshot({
    focusedAction: retryAction,
    page,
    secondaryAction: reservationListAction,
    state: "recovery",
    testInfo,
  })
  return screenshot
}

export async function assertCompletionNotFoundRoutes(page: Page) {
  for (const id of [
    reservationIds.foreign,
    "40000000-0000-4000-8000-000000000799",
    "malformed-reservation-id",
  ]) {
    const response = await page.goto(`/reservations/${id}/complete`)
    expect(response?.status(), id).toBe(404)
    await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
    await expect(page.getByText("외부 학습자")).toHaveCount(0)
  }
}
