import { expect, type Page } from "@playwright/test"
import {
  foreignLessonTitle,
  ownedLessonTitle,
  reservationIds,
} from "./learner-reservations-fixtures"
import { assertReservationFilter } from "./learner-reservations-page-helpers"
import { captureReservationScreenshot } from "./learner-reservations-visual-assertions"

type MyPageHub = Readonly<{
  page: Page
  projectName: string
}>

export async function assertUnauthenticatedReservationRoutes(page: Page) {
  for (const route of [
    "/mypage",
    "/mypage/reservations",
    `/mypage/reservations/${reservationIds.foreign}`,
  ]) {
    await page.goto(route)
    const redirectedUrl = new URL(page.url())
    expect(redirectedUrl.pathname).toBe("/auth/login")
    expect(redirectedUrl.searchParams.get("next")).toBe(route)
    await expect(
      page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." }),
    ).toBeVisible()
  }
}

export async function assertMyPageHeading(page: Page) {
  await expect(page.getByRole("heading", { name: "마이페이지" })).toBeVisible()
}

export async function assertMyPageProfile({ page, projectName }: MyPageHub) {
  await expect(page.getByText("김스포").first()).toBeVisible()
  await captureReservationScreenshot(page, projectName, "hub")
}

export async function assertReservationNavigation(page: Page, projectName: string) {
  const legacyReservationLink = page.getByRole("link", { exact: true, name: "예약 보기" })
  const reservationLink = page.getByRole("link", { exact: true, name: "내 예약 관리로 이동" })
  await expect(legacyReservationLink).toHaveCount(0)
  await expect(reservationLink).toBeVisible()
  await reservationLink.click()
  await expect(page).toHaveURL(/\/mypage\/reservations$/u)
  await expect(page.getByRole("heading", { name: "내 예약" })).toBeVisible()
  await expect(page.locator("article")).toHaveCount(8)
  await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
  for (const status of [
    "결제 대기",
    "예약 확정",
    "수업 완료",
    "학습자 취소",
    "학습자 노쇼",
    "분쟁 중",
  ]) {
    await expect(page.getByText(status).first()).toBeVisible()
  }
  await captureReservationScreenshot(page, projectName, "list-all")
  await assertPendingReservations(page)
  await assertConfirmedReservation(page, projectName)
  await assertReservationFilters(page)
  const foreignResponse = await page.goto(`/mypage/reservations/${reservationIds.foreign}`)
  expect(foreignResponse?.status()).toBe(404)
  await expect(page.getByText(foreignLessonTitle)).toHaveCount(0)
  await expect(page.getByText("외부 예약 학습자")).toHaveCount(0)
}

async function assertPendingReservations(page: Page) {
  await assertReservationFilter(page, "결제 대기", "pending", 2, "결제 대기")
  const continueLink = page.getByRole("link", { name: "결제 계속" })
  await expect(continueLink).toHaveCount(1)
  await expect(continueLink).toHaveAttribute(
    "href",
    `/reservations/${reservationIds.pending}/payment`,
  )
  await continueLink.click()
  await expect(page).toHaveURL(`/reservations/${reservationIds.pending}/payment`)
  await expect(page.getByRole("heading", { name: "결제 요청 정보를 준비해요" })).toBeVisible()
  await page.goto(`/mypage/reservations/${reservationIds.expired}`)
  await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
  await expect(page.getByRole("link", { name: "결제 계속" })).toHaveCount(0)
  await expect(page.getByText("현재 상태에서는 결제를 계속할 수 없어요.")).toBeVisible()
}

async function assertConfirmedReservation(page: Page, projectName: string) {
  await page.goto(`/mypage/reservations/${reservationIds.confirmed}`)
  await expect(page.getByRole("heading", { name: ownedLessonTitle })).toBeVisible()
  await expect(page.getByText("현재 예약 상태는 취소 요청 대상이에요.")).toBeVisible()
  await expect(page.getByText("현재 시각 기준 예상 환불액 7,000원")).toBeVisible()
  await expect(page.getByText(/수업 시작 24시간 이상 전/u)).toBeVisible()
  await expect(page.getByText(/수업 시작 3시간 이상 24시간 미만/u)).toBeVisible()
  await expect(page.getByText("이 화면에서는 취소 요청을 제출할 수 없어요.")).toBeVisible()
  await expect(page.getByRole("button", { name: /취소/u })).toHaveCount(0)
  await captureReservationScreenshot(page, projectName, "detail-confirmed")
  await page.getByRole("link", { name: "예약 목록" }).click()
  await expect(page).toHaveURL(/\/mypage\/reservations$/u)
}

async function assertReservationFilters(page: Page) {
  await assertReservationFilter(page, "예약 확정", "confirmed", 2, "예약 확정")
  await assertReservationFilter(page, "완료", "completed", 1, "수업 완료")
  await assertReservationFilter(page, "취소", "cancelled", 1, "학습자 취소")
  await assertReservationFilter(page, "노쇼", "no_show", 1, "학습자 노쇼")
  await assertReservationFilter(page, "분쟁", "disputed", 1, "분쟁 중")
}
