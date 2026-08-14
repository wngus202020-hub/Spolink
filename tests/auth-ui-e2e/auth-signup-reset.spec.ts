import { expect, test } from "@playwright/test"
import {
  expectNoBrowserLeak,
  mockRecoveryStart,
  mockSignup,
  mockSignupError,
  replacementPassword,
  submitCurrentFormTwice,
  testEmail,
  testPassword,
} from "./auth-form-helpers"

test("signup with an immediate session routes to profile onboarding", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "signup-session")
  await mockSignup(page, "present")

  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
  await page.getByLabel("비밀번호 확인").fill(testPassword)
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect(page).toHaveURL(/\/onboarding\/profile$/)
  await expectNoBrowserLeak(page, [email, testPassword])
})

test("signup with a null session routes to check-email without storing email", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "signup-null-session")
  await mockSignup(page, "null")

  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
  await page.getByLabel("비밀번호 확인").fill(testPassword)
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect(page).toHaveURL(/\/auth\/check-email$/)
  await expect(page.getByRole("status")).toContainText("가입 메일을 보냈어요.")
  await expectNoBrowserLeak(page, [email, testPassword])
})

test("duplicate signup submit emits one signup request", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "duplicate-signup")
  const signup = await mockSignup(page, "present")

  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(email)
  await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
  await page.getByLabel("비밀번호 확인").fill(testPassword)
  await submitCurrentFormTwice(page)

  await expect.poll(signup.count).toBe(1)
})

test("weak and mismatched password focuses the first invalid signup field", async ({
  page,
}, testInfo) => {
  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "invalid-signup"))
  await page.getByLabel("비밀번호", { exact: true }).fill("short")
  await page.getByLabel("비밀번호 확인").fill(replacementPassword)
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused()
  await expect(page.getByText("비밀번호는 8자 이상 16자 이하로 입력하면 돼요.")).toBeVisible()
  await expect(page.getByText("비밀번호가 일치하지 않아요.")).toBeVisible()
})

test("signup rejects passwords longer than 16 characters", async ({ page }, testInfo) => {
  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "long-password"))
  await page.getByLabel("비밀번호", { exact: true }).fill("SpolinkAuth1!TooLong")
  await page.getByLabel("비밀번호 확인").fill("SpolinkAuth1!TooLong")
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused()
  await expect(page.getByText("비밀번호는 8자 이상 16자 이하로 입력하면 돼요.")).toBeVisible()
  await expect(page.getByText("비밀번호가 일치하지 않아요.")).toHaveCount(0)
})

test("signup rejects mismatched password confirmation", async ({ page }, testInfo) => {
  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "mismatched-password"))
  await page.getByLabel("비밀번호", { exact: true }).fill("SpolinkAuth1!")
  await page.getByLabel("비밀번호 확인").fill("SpolinkAuth2!")
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect(page.getByLabel("비밀번호 확인")).toBeFocused()
  await expect(page.getByText("비밀번호가 일치하지 않아요.")).toBeVisible()
  await expect(page.getByText("비밀번호는 8자 이상 16자 이하로 입력하면 돼요.")).toHaveCount(0)
})

test("signup maps duplicate provider email errors to the email field", async ({
  page,
}, testInfo) => {
  const signup = await mockSignupError(
    page,
    "user_already_exists",
    "User with this email cannot be created again.",
  )

  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "duplicate-provider-email"))
  await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
  await page.getByLabel("비밀번호 확인").fill(testPassword)
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect.poll(signup.count).toBe(1)
  await expect(page.getByLabel("이메일")).toBeFocused()
  await expect(
    page.getByText("이미 가입된 이메일이에요. 로그인하거나 다른 이메일을 입력해요."),
  ).toBeVisible()
  await expect(page.getByText("가입을 완료할 수 없어요. 입력 정보를 확인해요.")).toHaveCount(0)
})

test("signup maps provider weak password errors to the password field", async ({
  page,
}, testInfo) => {
  const signup = await mockSignupError(page, "weak_password", "Password is too weak.")

  await page.goto("/auth/signup")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "provider-weak-password"))
  await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
  await page.getByLabel("비밀번호 확인").fill(testPassword)
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  await expect.poll(signup.count).toBe(1)
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused()
  await expect(page.getByText("비밀번호는 8자 이상 16자 이하로 입력하면 돼요.")).toBeVisible()
  await expect(page.getByText("가입을 완료할 수 없어요. 입력 정보를 확인해요.")).toHaveCount(0)
})

test("known and unknown reset emails show identical success copy with one request each", async ({
  page,
}, testInfo) => {
  const knownEmail = testEmail(testInfo, "known-reset")
  const unknownEmail = testEmail(testInfo, "unknown-reset")
  const recovery = await mockRecoveryStart(page)

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(knownEmail)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()
  const knownCopy = await page.getByRole("status").textContent()

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(unknownEmail)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()
  const unknownCopy = await page.getByRole("status").textContent()

  expect(knownCopy).toBe(unknownCopy)
  expect(recovery.count()).toBe(2)
  await expectNoBrowserLeak(page, [knownEmail, unknownEmail])
})

test("duplicate reset submit emits one recovery request", async ({ page }, testInfo) => {
  const recovery = await mockRecoveryStart(page)

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "duplicate-reset"))
  await submitCurrentFormTwice(page)

  await expect.poll(recovery.count).toBe(1)
})
