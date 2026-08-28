import { expect, type Page, type TestInfo } from "@playwright/test"
import {
  cleanupProfileEditSession,
  createProfileEditSession,
  insertProfileEditProfile,
  type ProfileEditSession,
  profileEditValues,
} from "./mypage-profile-edit-fixtures"
import { appendProfileEditObservation } from "./mypage-profile-edit-visual"

export async function runProfileEditRedirectScenario(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const sessions: ProfileEditSession[] = []
  try {
    await page.goto("/mypage/profile")
    await expect(page).toHaveURL(/\/auth\/login/u)
    const anonymousUrl = new URL(page.url())
    expect(anonymousUrl.pathname).toBe("/auth/login")
    expect(anonymousUrl.searchParams.get("next")).toBe("/mypage/profile")

    const profileRequired = await createProfileEditSession(page, testInfo, "required")
    sessions.push(profileRequired)
    await page.goto("/mypage/profile")
    await expect(page).toHaveURL(/\/onboarding\/profile$/u)

    await page.context().clearCookies()
    const suspended = await createProfileEditSession(page, testInfo, "suspended")
    sessions.push(suspended)
    await insertProfileEditProfile(suspended.userId, {
      ...profileEditValues(testInfo, "suspended"),
      status: "suspended",
    })
    await page.goto("/mypage/profile")
    await expect(page).toHaveURL(/\/auth\/login\?error=account-suspended$/u)

    await page.context().clearCookies()
    const deleted = await createProfileEditSession(page, testInfo, "deleted")
    sessions.push(deleted)
    await insertProfileEditProfile(deleted.userId, {
      ...profileEditValues(testInfo, "deleted"),
      status: "deleted",
    })
    await page.goto("/mypage/profile")
    await expect(page).toHaveURL(/\/auth\/login\?error=account-deleted$/u)

    await appendProfileEditObservation({
      project: testInfo.project.name,
      redirects: {
        anonymous: "/auth/login?next=/mypage/profile",
        deleted: "/auth/login?error=account-deleted",
        profileRequired: "/onboarding/profile",
        suspended: "/auth/login?error=account-suspended",
      },
      type: "redirects",
    })
  } finally {
    for (const session of sessions.toReversed()) await cleanupProfileEditSession(session)
  }
}
