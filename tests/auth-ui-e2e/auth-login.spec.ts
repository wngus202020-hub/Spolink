import { expect, test } from "@playwright/test"
import {
  expectAuthFormAlert,
  focusLoginEmailByKeyboard,
  mockLogout,
  mockMe,
  mockPasswordLogin,
  submitCurrentFormTwice,
  testEmail,
  testPassword,
  wrongPassword,
} from "./auth-form-helpers"

test.beforeEach(async ({ page }) => {
  await mockLogout(page)
})

test("login allowed success follows the fixed next destination", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "login-allowed")
  await mockPasswordLogin(page)
  await mockMe(page, 200, { data: { id: "profile-id", status: "active" } })

  await page.goto("/auth/login?next=/lessons")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: /로그인/ }).click()

  await expect(page).toHaveURL(/\/lessons$/)
})

test("keyboard-only login sends profile-missing users to onboarding", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "profile-missing")
  await mockPasswordLogin(page)
  await mockMe(page, 409, { error: { code: "PROFILE_REQUIRED", details: [], message: "" } })

  await page.goto("/auth/login?next=/lessons")
  await focusLoginEmailByKeyboard(page)
  await page.keyboard.type(email)
  await page.keyboard.press("Tab")
  await expect(page.getByLabel("비밀번호")).toBeFocused()
  await page.keyboard.type(testPassword)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/onboarding\/profile$/)
})

test("suspended login redirects to the stable Korean account alert", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "suspended")
  await mockPasswordLogin(page)
  await mockMe(page, 403, {
    error: { code: "ACCOUNT_SUSPENDED", details: [], message: "Account is suspended." },
  })

  await page.goto("/auth/login")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: /로그인/ }).click()

  await expect(page).toHaveURL(/\/auth\/login\?error=account-suspended$/)
  await expectAuthFormAlert(page, "현재 이용이 제한된 계정이에요.")
})

test("deleted login redirects to the stable Korean account alert", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "deleted")
  await mockPasswordLogin(page)
  await mockMe(page, 403, {
    error: { code: "ACCOUNT_DELETED", details: [], message: "Account is unavailable." },
  })

  await page.goto("/auth/login")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: /로그인/ }).click()

  await expect(page).toHaveURL(/\/auth\/login\?error=account-deleted$/)
  await expectAuthFormAlert(page, "탈퇴 처리된 계정이에요.")
})

test("wrong password shows generic invalid copy", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "wrong-password")
  await mockPasswordLogin(page, 400)

  await page.goto("/auth/login")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(wrongPassword)
  await page.getByRole("button", { name: /로그인/ }).click()

  await expectAuthFormAlert(page, "이메일 또는 비밀번호를 확인해요.")
})

test("login rejects external next values and falls back to canonical lessons", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "next-allowlist")
  await mockPasswordLogin(page)
  await mockMe(page, 200, { data: { id: "profile-id", status: "active" } })

  await page.goto("/auth/login?next=https%3A%2F%2Fevil.test")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await page.getByRole("button", { name: /로그인/ }).click()

  await expect(page).toHaveURL(/\/lessons$/)
})

test("duplicate login submit emits one password request", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "duplicate-login")
  const login = await mockPasswordLogin(page)
  await mockMe(page, 200, { data: { id: "profile-id", status: "active" } })

  await page.goto("/auth/login")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호").fill(testPassword)
  await submitCurrentFormTwice(page)

  await expect.poll(login.count).toBe(1)
})
