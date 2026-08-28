import { expect, test } from "@playwright/test"

import "./favorites.spec"
import "./reviews.spec"
import "./trust-safety.spec"
import { registerAdminDashboardScenarios } from "./admin-dashboard-scenario"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import {
  cleanupTrustSafetyFixture,
  createTrustSafetyFixture,
  login,
  logout,
  postJson,
} from "./trust-safety-helpers"

const roleRoutes = {
  learner: ["/mypage/favorites", "/mypage/notifications", "/mypage/trust-safety"],
  coach: ["/coach/lessons", "/coach/reservations", "/coach/settlements"],
  admin: ["/admin", "/admin/reports", "/admin/reservations", "/admin/settlements"],
} as const

test.describe("Todo 10 authenticated route and state verification", () => {
  test("profile-required and wrong-role boundaries are rendered by real routes", async ({
    page,
  }, testInfo) => {
    const fixture = await createTrustSafetyFixture(testInfo)
    const profileRequiredEmail = testEmail(testInfo, "task-10-profile-required")
    try {
      await createLiveAuthSession(page, profileRequiredEmail, testPassword)
      await page.goto("/mypage/favorites")
      await expect(page).toHaveURL("/onboarding/profile")
      await page.context().clearCookies()

      await page.goto("/mypage/favorites")
      await expect.poll(() => new URL(page.url()).pathname).toBe("/auth/login")
      await expect
        .poll(() => new URL(page.url()).searchParams.get("next"))
        .toBe("/mypage/favorites")

      await login(page, fixture.learnerEmail, "/lessons")
      const learnerCoachRoute = await page.request.get("/coach/lessons", { maxRedirects: 0 })
      const learnerCoachBody = await learnerCoachRoute.text()
      expect(learnerCoachBody).not.toContain("내 레슨")
      expect(learnerCoachBody).toContain("/coach/apply/status")
      await page.goto("/admin/reports")
      await expect(page).toHaveURL("/mypage")

      await logout(page)
      await login(page, fixture.coachEmail, "/coach/lessons")
      await page.goto("/admin/reservations")
      await expect(page).toHaveURL("/mypage")

      await logout(page)
      await login(page, fixture.adminEmail, "/admin/reports")
      const adminCoachRoute = await page.request.get("/coach/lessons", { maxRedirects: 0 })
      const adminCoachBody = await adminCoachRoute.text()
      expect(adminCoachBody).not.toContain("내 레슨")
      expect(adminCoachBody).toContain("/coach/apply/status")
    } finally {
      await cleanupTrustSafetyFixture(fixture)
      await cleanupLiveAuthUser(profileRequiredEmail)
    }
  })

  test("learner, coach, and admin route matrices have no overflow or visible overlap", async ({
    page,
  }, testInfo) => {
    const fixture = await createTrustSafetyFixture(testInfo)
    try {
      const sessions = [
        { email: fixture.learnerEmail, routes: roleRoutes.learner },
        { email: fixture.coachEmail, routes: roleRoutes.coach },
        { email: fixture.adminEmail, routes: roleRoutes.admin },
      ] as const
      for (const session of sessions) {
        await login(page, session.email, "/lessons")
        for (const route of session.routes) {
          await page.goto(route, { waitUntil: "networkidle" })
          await expect(page.locator("main")).toBeVisible()
          const metrics = await page.evaluate(() => {
            const viewport = { width: innerWidth, height: innerHeight }
            const overflow =
              document.documentElement.scrollWidth - document.documentElement.clientWidth
            const elements = [
              ...document.querySelectorAll(
                "main h1, main h2, main button, main a, main input, main select, main textarea",
              ),
            ].filter((element) => {
              const rect = element.getBoundingClientRect()
              return rect.width > 0 && rect.height > 0
            })
            const overlaps: string[] = []
            for (let index = 0; index < elements.length; index += 1) {
              const firstElement = elements[index]
              if (!firstElement) continue
              const first = firstElement.getBoundingClientRect()
              for (const secondElement of elements.slice(index + 1)) {
                const second = secondElement.getBoundingClientRect()
                if (
                  first.left < second.right &&
                  first.right > second.left &&
                  first.top < second.bottom &&
                  first.bottom > second.top
                ) {
                  const firstText =
                    firstElement.textContent?.trim().slice(0, 32) ?? firstElement.tagName
                  const secondText =
                    secondElement.textContent?.trim().slice(0, 32) ?? secondElement.tagName
                  if (firstText && secondText) overlaps.push(`${firstText}|${secondText}`)
                }
              }
            }
            return { overflow, overlaps: overlaps.slice(0, 5), viewport }
          })
          expect(metrics.overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(0)
          expect(metrics.overlaps, `${route} visible overlap`).toEqual([])
          await capture(page, testInfo.project.name, route.slice(1).replaceAll("/", "-"))
        }
        await logout(page)
      }
    } finally {
      await cleanupTrustSafetyFixture(fixture)
    }
  })

  test("actual loading, empty, error, and success states are observable", async ({
    page,
  }, testInfo) => {
    const fixture = await createTrustSafetyFixture(testInfo)
    try {
      await login(page, fixture.adminEmail, "/admin/reservations")
      await page.goto("/admin/reservations?uiState=loading", { waitUntil: "commit" })
      await expect(
        page.getByText("예약 운영 목록을 불러오는 중입니다…", { exact: true }),
      ).toBeVisible()

      await page.goto("/admin/reservations?uiState=error")
      await expect(page.locator("main[role=alert]")).toBeVisible()
      await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible()

      await page.goto("/admin/reports?status=rejected")
      await expect(page.getByText("해당 상태의 신고가 없습니다.", { exact: true })).toBeVisible()

      await page.goto("/admin/reservations")
      await expect(page.getByRole("heading", { name: "예약 운영" })).toBeVisible()
      await expect(page.locator("main")).not.toHaveAttribute("role", "alert")

      await logout(page)
      await login(page, fixture.learnerEmail, "/lessons")
      const report = await postJson(page, "/api/reports", {
        detail: "알림 읽음 mutation 검증",
        reason: "알림 검증",
        targetId: fixture.lessonId,
        targetType: "lesson",
      })
      expect(report.status).toBe(201)
      const reportId = readId(report.body)
      await logout(page)
      await login(page, fixture.adminEmail, "/admin/reports")
      expect(
        (
          await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
            action: "start_review",
            moderationAction: "none",
            resolutionNote: null,
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await postJson(page, `/api/admin/reports/${reportId}/resolve`, {
            action: "resolve",
            moderationAction: "none",
            resolutionNote: "알림 읽음 mutation 검증 완료",
          })
        ).status,
      ).toBe(200)
      await logout(page)
      await login(page, fixture.learnerEmail, "/mypage/notifications")
      const readRequests = { count: 0 }
      page.on("request", (request) => {
        if (request.url().includes("/api/notifications/") && request.url().endsWith("/read")) {
          readRequests.count += 1
        }
      })
      const unread = page.getByRole("button", { name: "알림 읽음 처리" }).first()
      await expect(unread).toBeVisible()
      await unread.click()
      await unread.click({ force: true })
      await expect.poll(() => readRequests.count).toBe(1)
      await expect(page.getByRole("button", { name: "읽은 알림" }).first()).toBeDisabled()
    } finally {
      await cleanupTrustSafetyFixture(fixture)
    }
  })

  test("coach mutation disables duplicate submit and preserves idempotent replay", async ({
    page,
  }, testInfo) => {
    const fixture = await createTrustSafetyFixture(testInfo)
    try {
      await login(page, fixture.coachEmail, "/coach/reservations")
      const requestCount = { complete: 0 }
      page.on("request", (request) => {
        if (
          request.url().endsWith(`/api/reservations/${fixture.confirmedReservationId}/complete`)
        ) {
          requestCount.complete += 1
        }
      })
      const completeButton = page.getByRole("button", { name: "수업 완료" })
      const completionResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/reservations/${fixture.confirmedReservationId}/complete`) &&
          response.request().method() === "POST",
      )
      await completeButton.click()
      const completion = await completionResponse
      expect(completion.status()).toBe(200)
      await expect.poll(() => requestCount.complete).toBe(1)
      await expect(completeButton).toHaveCount(0)
      const stale = await postJson(
        page,
        `/api/reservations/${fixture.confirmedReservationId}/complete`,
        {},
      )
      expect(stale.status).toBe(200)
      expect(stale.body).toMatchObject({ data: { status: "completed" } })
      await expect.poll(() => requestCount.complete).toBe(2)
    } finally {
      await cleanupTrustSafetyFixture(fixture)
    }
  })
})

registerAdminDashboardScenarios()

async function capture(page: import("@playwright/test").Page, project: string, route: string) {
  const outputDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!outputDir) return
  await page.screenshot({
    fullPage: true,
    path: `${outputDir}/task-10-${project}-${route}.png`,
  })
}

function readId(body: unknown): string {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    throw new Error("Mutation response did not include data")
  }
  const data = body.data
  if (typeof data !== "object" || data === null || !("id" in data) || typeof data.id !== "string") {
    throw new Error("Mutation response did not include a stable id")
  }
  return data.id
}
