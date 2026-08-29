import { expect, type Page, type TestInfo } from "@playwright/test"

import { withCoachDashboardLiveFixture } from "./coach-dashboard-live-fixture"

const quickActions = [
  ["새 레슨 등록", "/coach/lessons/new"],
  ["레슨 일정 관리", "/coach/lessons"],
  ["예약 관리", "/coach/reservations"],
  ["정산 관리", "/coach/settlements"],
] as const

export async function runCoachDashboardPopulatedScenario(page: Page, testInfo: TestInfo) {
  await withCoachDashboardLiveFixture(page, testInfo, "populated-navigation", async (fixture) => {
    fixture.markStage("page")
    await fixture.activatePersona("approved-owner")
    const response = await page.goto("/coach/dashboard")
    expect(response?.status()).toBe(200)
    expect(response?.headers()["cache-control"]).toMatch(
      /^(?:private, no-store|no-cache, must-revalidate)$/u,
    )
    await expect(page).toHaveURL(/\/coach\/dashboard$/u)
    await expect(page.getByRole("heading", { level: 1, name: "지도자 운영 센터" })).toBeVisible()

    fixture.markStage("metrics")
    const summary = page.getByRole("region", { name: "운영 요약" })
    await expectMetric(summary, "결제 대기", "2건")
    await expectMetric(summary, "예약 확정", "3건")
    await expectMetric(summary, "완료 처리 대기", "3건")
    await expectMetric(summary, "정산 예정", "25,500원")

    fixture.markStage("schedule-day-start")
    const schedules = page.getByRole("region", { name: "오늘 일정" })
    await expect(schedules.getByText("OWNER_DAY_START_LESSON", { exact: true })).toBeVisible()
    fixture.markStage("schedule-closed")
    const closed = schedules
      .getByText("OWNER_CLOSED_LESSON", { exact: true })
      .locator("xpath=ancestor::li")
    await expect(closed.getByText("마감", { exact: true })).toBeVisible()
    fixture.markStage("schedule-zero")
    const zero = schedules
      .getByText("OWNER_ZERO_LESSON", { exact: true })
      .locator("xpath=ancestor::li")
    await expect(zero.getByText("0 / 4명", { exact: true })).toBeVisible()
    fixture.markStage("schedule-exclusions")
    await expect(schedules.getByText("OWNER_DAY_END_EXCLUDED", { exact: true })).toHaveCount(0)
    await expect(schedules.getByText("FOREIGN_LESSON_SENTINEL", { exact: true })).toHaveCount(0)

    fixture.markStage("settlements")
    const settlement = page.getByRole("region", { name: "정산 예정" })
    await expect(settlement.getByText("25,500원", { exact: true })).toBeVisible()
    await expect(page.getByText("7,000원", { exact: true })).toHaveCount(0)
    await expect(page.getByText("99,000원", { exact: true })).toHaveCount(0)

    fixture.markStage("reviews")
    const reviews = page.getByRole("region", { name: "최근 리뷰" })
    await expect(reviews.getByRole("listitem")).toHaveCount(3)
    for (const content of ["OWNER_REVIEW_ALPHA", "OWNER_REVIEW_BETA", "OWNER_REVIEW_GAMMA"]) {
      await expect(reviews.getByText(content, { exact: true })).toBeVisible()
    }
    for (const excluded of [
      "OWNER_REVIEW_OLD_EXCLUDED",
      "HIDDEN_REVIEW_SENTINEL",
      "DELETED_REVIEW_SENTINEL",
      "FOREIGN_REVIEW_SENTINEL",
    ]) {
      await expect(reviews.getByText(excluded, { exact: true })).toHaveCount(0)
    }

    fixture.markStage("notifications")
    const notifications = page.getByRole("region", { name: "읽지 않은 알림" })
    await expect(notifications.getByText("4건", { exact: true })).toBeVisible()
    await expect(notifications.getByRole("listitem")).toHaveCount(3)
    for (const title of ["OWNER_NOTICE_ALPHA", "OWNER_NOTICE_BETA", "OWNER_NOTICE_GAMMA"]) {
      await expect(notifications.getByText(title, { exact: true })).toBeVisible()
    }
    for (const excluded of [
      "OWNER_NOTICE_OLD_EXCLUDED",
      "READ_NOTICE_SENTINEL",
      "FOREIGN_NOTICE_SENTINEL",
    ]) {
      await expect(notifications.getByText(excluded, { exact: true })).toHaveCount(0)
    }

    fixture.markStage("privacy")
    const dashboardBody = await page.locator("body").innerText()
    for (const forbidden of fixture.forbiddenDomValues)
      expect(dashboardBody).not.toContain(forbidden)
    fixture.markStage("quick-actions")
    await assertQuickActionNavigation(page)
    fixture.markStage("center-links")
    await assertCenterEntryNavigation(page)
    fixture.markStage("capture")
    await page.goto("/coach/dashboard")
    await fixture.capture("populated-navigation")
    expect(fixture.runtimeErrors).toEqual([])
    fixture.markStage("complete")
  })
}

async function expectMetric(region: ReturnType<Page["getByRole"]>, label: string, value: string) {
  const item = region.getByText(label, { exact: true }).locator("xpath=ancestor::li")
  await expect(item.getByText(value, { exact: true })).toBeVisible()
}

async function assertQuickActionNavigation(page: Page) {
  for (const [label, href] of quickActions) {
    await page.goto("/coach/dashboard")
    const link = page.getByRole("link", { name: label, exact: true })
    await expect(link).toHaveAttribute("href", href)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`, "u"))
  }
}

async function assertCenterEntryNavigation(page: Page) {
  await page.goto("/lessons")
  const headerLink = page.getByRole("link", { name: "지도자 센터", exact: true })
  await expect(headerLink).toHaveAttribute("href", "/coach/dashboard")
  await headerLink.click()
  await expect(page).toHaveURL(/\/coach\/dashboard$/u)

  await page.goto("/mypage")
  const mypageLink = page.getByRole("link").filter({ hasText: "지도자 센터" }).first()
  await expect(mypageLink).toHaveAttribute("href", "/coach/dashboard")
  await mypageLink.click()
  await expect(page).toHaveURL(/\/coach\/dashboard$/u)
}
