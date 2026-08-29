import { expect, type Page, type TestInfo } from "@playwright/test"

import { withCoachDashboardLiveFixture } from "./coach-dashboard-live-fixture"

const applicantRedirects = ["applicant-draft", "applicant-submitted", "applicant-rejected"] as const

export async function runCoachDashboardAccessScenario(page: Page, testInfo: TestInfo) {
  await withCoachDashboardLiveFixture(page, testInfo, "redirect-ownership", async (fixture) => {
    fixture.markStage("anonymous")
    await assertAnonymousRedirect(page, fixture.markStage, fixture.runtimeErrors)

    fixture.markStage("profile-required")
    await fixture.activatePersona("profile-required")
    await page.goto("/coach/dashboard")
    await expect(page).toHaveURL(/\/onboarding\/profile$/u)

    fixture.markStage("active-learner")
    await fixture.activatePersona("active-learner")
    await page.goto("/coach/dashboard")
    await expect(page).toHaveURL(/\/coach\/apply$/u)

    fixture.markStage("applicants")
    for (const alias of applicantRedirects) {
      await fixture.activatePersona(alias)
      await page.goto("/coach/dashboard")
      await expect(page).toHaveURL(/\/coach\/apply\/status$/u)
    }

    fixture.markStage("restricted-suspended")
    await assertRestrictedRedirect(page, fixture, "restricted-suspended", "account-suspended")
    fixture.markStage("restricted-deleted")
    await assertRestrictedRedirect(page, fixture, "restricted-deleted", "account-deleted")

    fixture.markStage("approved-owner")
    await fixture.activatePersona("approved-owner")
    await page.goto("/coach/dashboard")
    await expect(page).toHaveURL(/\/coach\/dashboard$/u)

    fixture.markStage("foreign-owner")
    await fixture.activatePersona("foreign-coach")
    const response = await page.goto("/coach/dashboard")
    fixture.markStage("foreign-cache")
    expect(response?.headers()["cache-control"]).toMatch(
      /^(?:private, no-store|no-cache, must-revalidate)$/u,
    )
    fixture.markStage(await classifyForeignDashboard(page))
    await expect(page).toHaveURL(/\/coach\/dashboard$/u)
    await expect(
      page
        .getByRole("region", { name: "오늘 일정" })
        .getByText("FOREIGN_LESSON_SENTINEL", { exact: true }),
    ).toBeVisible()
    fixture.markStage("foreign-metrics")
    await expectMetric(page, "결제 대기", "1건")
    await expectMetric(page, "예약 확정", "1건")
    await expectMetric(page, "완료 처리 대기", "1건")
    fixture.markStage("foreign-settlement")
    await expect(page.getByText("99,000원", { exact: true }).first()).toBeVisible()
    fixture.markStage("foreign-review")
    await expect(page.getByText("FOREIGN_REVIEW_SENTINEL", { exact: true })).toBeVisible()
    fixture.markStage("foreign-notification")
    await expect(page.getByText("FOREIGN_NOTICE_SENTINEL", { exact: true })).toBeVisible()

    fixture.markStage("foreign-isolation")
    const body = await page.locator("body").innerText()
    for (const ownerValue of [
      "OWNER_DAY_START_LESSON",
      "OWNER_CLOSED_LESSON",
      "OWNER_ZERO_LESSON",
      "OWNER_REVIEW_ALPHA",
      "OWNER_REVIEW_BETA",
      "OWNER_REVIEW_GAMMA",
      "OWNER_NOTICE_ALPHA",
      "OWNER_NOTICE_BETA",
      "OWNER_NOTICE_GAMMA",
      "25,500원",
    ]) {
      expect(body).not.toContain(ownerValue)
    }
    for (const forbidden of fixture.forbiddenDomValues) expect(body).not.toContain(forbidden)
    await fixture.capture("redirect-ownership")
    expect(fixture.runtimeErrors).toEqual([])
    fixture.markStage("complete")
  })
}

async function expectMetric(page: Page, label: string, value: string) {
  const summary = page.getByRole("region", { name: "운영 요약" })
  const item = summary.getByText(label, { exact: true }).locator("xpath=ancestor::li")
  await expect(item.getByText(value, { exact: true })).toBeVisible()
}

async function assertAnonymousRedirect(
  page: Page,
  markStage: (stage: string) => void,
  runtimeErrors: string[],
) {
  const browser = page.context().browser()
  if (!browser) throw new Error("Playwright browser is required")
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
  const anonymousPage = await context.newPage()
  anonymousPage.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text())
  })
  anonymousPage.on("pageerror", (error) => runtimeErrors.push(error.message))
  try {
    await anonymousPage.goto("/coach/dashboard")
    await anonymousPage.waitForTimeout(1_000)
    const observedPath = classifyPath(new URL(anonymousPage.url()).pathname)
    const observedContent = (await anonymousPage
      .getByRole("heading", { name: "지도자 운영 센터" })
      .count())
      ? "dashboard-content"
      : "other-content"
    markStage(`anonymous-observed-${observedPath}-${observedContent}`)
    await expect(anonymousPage).toHaveURL(/\/auth\/login\?next=/u)
    const anonymousUrl = new URL(anonymousPage.url())
    markStage("anonymous-next")
    expect(anonymousUrl.searchParams.get("next")).toBe("/coach/dashboard")
  } finally {
    await context.close()
  }
}

async function assertRestrictedRedirect(
  page: Page,
  fixture: Parameters<Parameters<typeof withCoachDashboardLiveFixture>[3]>[0],
  alias: "restricted-suspended" | "restricted-deleted",
  reason: "account-suspended" | "account-deleted",
) {
  await fixture.activatePersona(alias)
  await page.route("**/auth/restricted?**", async (route) => {
    await route.fulfill({ body: "restricted", contentType: "text/plain", status: 200 })
  })
  try {
    await page.goto("/coach/dashboard")
    await expect(page).toHaveURL(new RegExp(`/auth/restricted\\?reason=${reason}$`, "u"))
  } finally {
    await page.unroute("**/auth/restricted?**")
  }
}

function classifyPath(pathname: string) {
  if (pathname === "/auth/login") return "login"
  if (pathname === "/coach/dashboard") return "dashboard"
  return "other"
}

async function classifyForeignDashboard(page: Page) {
  if (await page.getByText("FOREIGN_LESSON_SENTINEL", { exact: true }).count()) {
    return "foreign-content"
  }
  if (await page.getByText("오늘 예정된 일정이 없습니다.", { exact: true }).count()) {
    return "foreign-empty"
  }
  if (await page.getByRole("heading", { name: "지도자 운영 센터" }).count()) {
    return "foreign-dashboard-without-schedule"
  }
  return "foreign-nondashboard"
}
