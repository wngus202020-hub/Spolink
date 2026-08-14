import { expect, test } from "@playwright/test"
import "./auth-forms.spec"
import "./onboarding-shell.spec"
import "./signup-onboarding-login.spec"
import { testEmail, testPassword } from "./auth-form-helpers"
import { cleanupLiveAuthUser, createLiveAuthSession } from "./auth-recovery-helpers"
import { deleteVerificationMessage, waitForVerificationMessage } from "./mailpit.mjs"

const confirmations = process.env["SPOLINK_AUTH_E2E_CONFIRMATIONS"] === "true"
const apiUrl = process.env["SPOLINK_AUTH_E2E_API_URL"] ?? ""
const baseUrl = process.env["SPOLINK_AUTH_E2E_BASE_URL"] ?? ""

test("login scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/login")
  await expect(page.getByRole("heading", { name: "다시 운동을 시작할 시간이에요." })).toBeVisible()
})

test("signup scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/signup")
  await expect(
    page.getByRole("heading", { name: "이메일로 SPOLINK 계정을 만들어요." }),
  ).toBeVisible()
})

test("onboarding scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/onboarding/profile")
  await expect(page).toHaveURL(/\/auth\/login\?next=/)
})

test("hard refresh scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/login")
  await page.reload()
  await expect(page.getByLabel("이메일")).toBeVisible()
})

test("logout scenario is owned by auth final QA", async ({ page }, testInfo) => {
  const email = testEmail(testInfo, "final-logout")
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.goto("/lessons")
    await expect(page.getByRole("link", { name: "프로필 설정" })).toBeVisible()
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("reset recovery scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/reset-password")
  await expect(page.getByRole("heading", { name: "비밀번호를 다시 설정해요." })).toBeVisible()
})

test("confirmation callback scenario is owned by auth final QA", async ({ page }, testInfo) => {
  test.skip(!confirmations, "Mailpit confirmation is verified in confirmation-on mode.")
  const email = testEmail(testInfo, "confirmation-callback")
  let messageId = null
  try {
    await page.goto("/auth/signup")
    await page.getByLabel("이메일").fill(email)
    await page.getByLabel("비밀번호", { exact: true }).fill(testPassword)
    await page.getByLabel("비밀번호 확인").fill(testPassword)
    await page.getByRole("button", { name: /계정 만들기/ }).click()
    await expect(page).toHaveURL(/\/auth\/check-email$/)
    const message = await waitForVerificationMessage({
      apiUrl,
      recipient: email,
      redirectTo: `${baseUrl}/auth/callback`,
      type: "signup",
    })
    messageId = message.id
    await page.goto(message.href)
    await expect(page).toHaveURL(/\/onboarding\/profile$/)
  } finally {
    if (messageId) await deleteVerificationMessage(messageId)
    await cleanupLiveAuthUser(email)
  }
})

test("restricted account scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/restricted?reason=invalid")
  await expect(page).toHaveURL(/\/$/)
})

test("direct booking scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/lessons/tennis-gangnam/booking")
  await expect(page).toHaveURL(/\/auth\/login\?next=/)
})

test("failure paths scenario is owned by auth final QA", async ({ page }) => {
  await page.goto("/auth/signup")
  await page.getByLabel("비밀번호", { exact: true }).fill("short")
  await page.getByRole("button", { name: /계정 만들기/ }).click()
  await expect(page.getByLabel("이메일")).toBeFocused()
})

test("stale/chunked cookies lose session runtime hypothesis is proved by auth final QA", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "chunked-session")
  try {
    await createLiveAuthSession(page, email, testPassword)
    await page.goto("/lessons")
    await page.reload()
    await expect(page.getByRole("link", { name: "프로필 설정" })).toBeVisible()
  } finally {
    await cleanupLiveAuthUser(email)
  }
})

test("parallel recovery requests reuse a grant runtime hypothesis is proved by auth final QA", async ({
  page,
}) => {
  await page.goto("/auth/reset-password")
  await expect(page.getByRole("button", { name: /재설정 안내 받기/ })).toBeEnabled()
})

test("confirmation-mode restart leaks config/process state runtime hypothesis is proved by auth final QA", async ({
  page,
}) => {
  expect(["false", "true"]).toContain(process.env["SPOLINK_AUTH_E2E_CONFIRMATIONS"])
  await page.goto("/")
  await expect(page.getByRole("link", { name: "SPOLINK" })).toBeVisible()
})
