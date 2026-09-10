import { createHash } from "node:crypto"
import { expect, test } from "@playwright/test"

import {
  cleanupProfileEditSession,
  createProfileEditSession,
  insertProfileEditProfile,
  type ProfileEditSession,
  profileEditValues,
  readProfileEditSnapshot,
} from "./mypage-profile-edit-fixtures"

test("account owner reviews settings and completes confirmed withdrawal", async ({
  page,
}, testInfo) => {
  let session: ProfileEditSession | null = null
  try {
    session = await createProfileEditSession(page, testInfo, "account-settings")
    const profile = profileEditValues(testInfo, "account-settings")
    await insertProfileEditProfile(session.userId, profile)

    await page.goto("/mypage/settings")
    await expect(page.getByRole("heading", { level: 1, name: "계정 설정" })).toBeVisible()
    await expect(page.locator("[data-account-email]")).toHaveText(session.email)
    await expect(page.getByText("이용 가능", { exact: true })).toBeVisible()
    await page.locator("[data-account-email]").evaluate((element) => {
      element.textContent = "이메일 비공개"
    })
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: `.omo/evidence/account-settings/${testInfo.project.name}-page.png`,
    })

    const trigger = page.getByRole("button", { name: "회원 탈퇴", exact: true })
    await trigger.click()
    const dialog = page.getByRole("dialog", { name: "정말 회원 탈퇴할까요?" })
    const confirmation = dialog.getByLabel("확인 문구")
    const submit = dialog.getByRole("button", { name: "탈퇴 확정" })
    await expect(dialog).toBeVisible()
    await expect(confirmation).toBeFocused()
    await confirmation.fill("탈퇴")
    await expect(submit).toBeDisabled()
    await confirmation.fill("탈퇴하기")
    await expect(submit).toBeEnabled()
    await page.screenshot({
      animations: "disabled",
      path: `.omo/evidence/account-settings/${testInfo.project.name}-dialog.png`,
    })

    await dialog.getByRole("button", { name: "취소" }).click()
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    await trigger.click()
    await dialog.getByLabel("확인 문구").fill("탈퇴하기")
    await dialog.getByRole("button", { name: "탈퇴 확정" }).click()
    await expect(page).toHaveURL(/\/?account=deleted$/u)

    const snapshot = await readProfileEditSnapshot(session.userId)
    assertWithdrawnSnapshot(snapshot)

    await page.goto("/mypage/settings")
    await expect(page).toHaveURL((url) => {
      return url.pathname === "/auth/login" && url.searchParams.get("next") === "/mypage/settings"
    })
  } finally {
    if (session) await cleanupProfileEditSession(session)
  }
})

function assertWithdrawnSnapshot(snapshot: Awaited<ReturnType<typeof readProfileEditSnapshot>>) {
  expect(snapshot.status).toBe("deleted")
  expect(snapshot.displayNameHash).toBe(createHash("sha256").update("탈퇴한 사용자").digest("hex"))
  expect(snapshot.realNameHash).toBeNull()
  expect(snapshot.phoneHash).toBeNull()
  expect(snapshot.defaultRegion).toBeNull()
  expect(snapshot.locationAgreed).toBe(false)
  expect(snapshot.marketingAgreed).toBe(false)
}
