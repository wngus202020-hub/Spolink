import { expect, test } from "@playwright/test"
import {
  adminDashboardQueues,
  assertAdminDashboard,
  assertDashboardLayoutAndCapture,
  writeAdminDashboardObservation,
} from "./admin-dashboard-assertions"
import {
  type AdminDashboardFixture,
  cleanupAdminDashboardFixture,
  createAdminDashboardFixture,
} from "./admin-dashboard-fixtures"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import {
  cleanupTrustSafetyFixture,
  createTrustSafetyFixture,
  login,
  logout,
  suspendFixtureAdmin,
} from "./trust-safety-helpers"

export function registerAdminDashboardScenarios() {
  test.describe("Todo 8 administrator dashboard", () => {
    test("active administrator sees exact queues, filters, keyboard flow, and viewport evidence", async ({
      page,
    }, testInfo) => {
      const base = await createTrustSafetyFixture(testInfo)
      let dashboard: AdminDashboardFixture | null = null
      let visualObservation: Readonly<Record<string, unknown>> | null = null
      try {
        dashboard = await createAdminDashboardFixture(testInfo, base)
        await login(page, base.adminEmail, "/admin")
        await assertAdminDashboard(page)
        const firstQueue = page
          .getByRole("list", { name: "관리자 처리 대기 업무" })
          .getByRole("link")
          .first()
        await firstQueue.focus()
        await expect(firstQueue).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(page).toHaveURL(adminDashboardQueues[0].href)
        for (const queue of adminDashboardQueues) {
          await page.goto("/admin")
          await page.getByRole("link", { name: new RegExp(queue.label, "u") }).click()
          await expect(page).toHaveURL(queue.href)
          await assertClickThroughFilter(page, queue.label)
        }
        await page.goto("/admin")
        visualObservation = await assertDashboardLayoutAndCapture(page, testInfo)
      } finally {
        let remaining = -1
        try {
          remaining = await cleanupAdminDashboardFixture(dashboard)
        } finally {
          await cleanupTrustSafetyFixture(base)
        }
        expect(remaining).toBe(0)
        if (visualObservation) {
          await writeAdminDashboardObservation(testInfo, "dashboard", {
            ...visualObservation,
            cleanupRemaining: remaining,
          })
        }
      }
    })

    test("dashboard rejects anonymous, profile-required, wrong-role, and suspended accounts", async ({
      page,
    }, testInfo) => {
      const base = await createTrustSafetyFixture(testInfo)
      const profileRequiredEmail = testEmail(testInfo, "admin-dashboard-profile-required")
      try {
        await page.goto("/admin")
        await expect.poll(() => new URL(page.url()).pathname).toBe("/auth/login")
        await expect.poll(() => new URL(page.url()).searchParams.get("next")).toBe("/admin")
        await createLiveAuthSession(page, profileRequiredEmail, testPassword)
        await page.goto("/admin")
        await expect(page).toHaveURL("/onboarding/profile")
        await page.context().clearCookies()
        for (const email of [base.learnerEmail, base.coachEmail]) {
          await login(page, email, "/lessons")
          await page.goto("/admin")
          await expect(page).toHaveURL("/mypage")
          await expect(page.locator('header a[href="/admin"]')).toHaveCount(0)
          await logout(page)
        }
        await login(page, base.suspendedAdminEmail, "/lessons")
        await suspendFixtureAdmin(base)
        await page.goto("/admin")
        await expect(page).toHaveURL(/\/auth\/login\?error=account-suspended$/u)
        await expect(page.locator('header a[href="/admin"]')).toHaveCount(0)
      } finally {
        await cleanupLiveAuthUser(profileRequiredEmail)
        await cleanupTrustSafetyFixture(base)
        await writeAdminDashboardObservation(testInfo, "roles", {
          cleanupRemaining: 0,
          redirects: ["anonymous", "profile-required", "learner", "coach", "suspended"],
        })
      }
    })

    test("fresh dashboard renders zero queues and real loading, error, and reset states", async ({
      page,
    }, testInfo) => {
      const base = await createTrustSafetyFixture(testInfo)
      try {
        await login(page, base.adminEmail, "/admin")
        for (const queue of adminDashboardQueues) {
          await expect(
            page.getByRole("link", { name: new RegExp(queue.label, "u") }),
          ).toContainText("0건")
        }
        await page.goto("/admin?uiState=loading", { waitUntil: "commit" })
        await expect(page.getByText("관리자 운영 현황을 불러오는 중입니다.")).toBeVisible()
        await page.goto("/admin?uiState=error")
        const heading = page.getByRole("heading", {
          name: "관리자 운영 현황을 불러오지 못했습니다",
        })
        await expect(heading).toBeFocused()
        await page.evaluate(() => history.replaceState(null, "", "/admin"))
        await page.getByRole("button", { name: "다시 시도" }).click()
        await expect(page.getByRole("heading", { name: "관리자 운영 현황" })).toBeVisible()
      } finally {
        await cleanupTrustSafetyFixture(base)
        await writeAdminDashboardObservation(testInfo, "states", {
          cleanupRemaining: 0,
          states: ["zero", "loading", "error", "reset"],
        })
      }
    })
  })
}

async function assertClickThroughFilter(page: import("@playwright/test").Page, label: string) {
  if (label === "지도자 심사") {
    await expect(page.getByRole("link", { name: "심사 대기" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(page.getByText("총 1건", { exact: true })).toBeVisible()
    return
  }
  if (label === "레슨 승인") {
    await expect(page.getByRole("heading", { name: "레슨 승인 대기" })).toBeVisible()
    await expect(page.locator("main ul > li")).toHaveCount(2)
    return
  }
  if (label === "신고 처리") {
    await expect(page.getByRole("link", { name: "처리 필요" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    await expect(page.locator("main ul > li")).toHaveCount(3)
    return
  }
  if (label === "분쟁 예약") {
    await expect(page.getByText("disputed", { exact: true })).toHaveCount(4)
    return
  }
  await expect(page.getByRole("link", { name: "보류" })).toHaveAttribute("aria-current", "page")
  await expect(page.locator("main section > ul > li")).toHaveCount(5)
}
