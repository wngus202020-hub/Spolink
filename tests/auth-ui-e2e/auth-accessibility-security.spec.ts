import { expect, type Page, test } from "@playwright/test"
import {
  expectAuthFormAlert,
  expectNoBrowserLeak,
  mockMe,
  mockPasswordLogin,
  mockRecoveryStart,
  testEmail,
  testPassword,
} from "./auth-form-helpers"

test("auth forms expose visible labels and stable associated error regions", async ({ page }) => {
  await page.goto("/auth/signup")
  await page.getByRole("button", { name: /계정 만들기/ }).click()

  for (const label of ["이메일", "비밀번호", "비밀번호 확인"]) {
    const field = page.getByLabel(label, { exact: true })
    await expect(field).toBeVisible()
    const describedBy = await field.getAttribute("aria-describedby")
    expect(describedBy).toMatch(/-message$/)
    await expect(page.locator(`#${describedBy}`)).toBeVisible()
  }

  await expect(page.getByLabel("이메일")).toHaveAttribute("aria-invalid", "true")
})

test("auth shell explains SPOLINK account trust without extra auth modes", async ({ page }) => {
  await page.goto("/auth/login")

  const trustRegion = page.getByRole("complementary", { name: "SPOLINK 계정 안내" })
  await expect(trustRegion).toBeVisible()
  await expect(trustRegion).toContainText("이메일로 계정을 확인해요")
  await expect(trustRegion).toContainText("프로필은 확인 뒤 입력해요")
  await expect(trustRegion).toContainText("예약과 지도자 상태를 투명하게 보여드려요")
})

test("signup and reset pages describe the next account step clearly", async ({ page }) => {
  await page.goto("/auth/signup")
  await expect(
    page.getByText("프로필과 선택 동의는 이메일 확인 뒤 온보딩에서 이어져요."),
  ).toBeVisible()
  await expect(page.getByText("이메일 확인 후 필요한 정보만 단계별로 입력해요.")).toBeVisible()

  await page.goto("/auth/reset-password")
  await expect(page.getByText("가입한 이메일로 재설정 안내를 보내드려요.")).toBeVisible()
  await expect(page.getByText("계정 보호를 위해 요청 결과는 같은 안내로 표시돼요.")).toBeVisible()
})

test("keyboard Tab Shift-Tab and Enter drive login without a pointer", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "keyboard-loop")
  await mockPasswordLogin(page)
  await mockMe(page, 200, { data: { id: "profile-id", status: "active" } })

  await page.goto("/auth/login?next=/lessons")
  await focusLoginEmail(page)
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  await page.keyboard.type(email)
  await page.keyboard.press("Tab")
  await page.keyboard.type(testPassword)
  await page.keyboard.press("Enter")

  await expect(page).toHaveURL(/\/lessons$/)
})

test("first invalid reset field receives focus and a scoped alert stays visible", async ({
  page,
}) => {
  await page.goto("/auth/reset-password?error=recovery-required")

  await expectAuthFormAlert(page, "비밀번호 재설정 링크를 다시 요청해요.")
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  await expect(page.getByLabel("이메일")).toBeFocused()
  await expect(page.getByText("올바른 이메일을 입력해요.")).toBeVisible()
})

test("200 percent zoom keeps signup controls visible without horizontal overflow", async ({
  page,
}) => {
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 })

  await page.goto("/auth/signup")

  await expect(page.getByLabel("이메일")).toBeVisible()
  await expect(page.getByRole("button", { name: /계정 만들기/ })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(overflow).toBe(false)
})

test("reset flow keeps credentials and recovery request data out of URL storage and console", async ({
  page,
}, testInfo) => {
  const messages: string[] = []
  const email = testEmail(testInfo, "leakage")
  page.on("console", (message) => messages.push(message.text()))
  await mockRecoveryStart(page)

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(email)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  await expect(page.getByRole("status")).toContainText("비밀번호 재설정 안내")
  await expectNoBrowserLeak(page, [email])
  expect(messages.join("\n")).not.toContain(email)
})

async function focusLoginEmail(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await page.getByLabel("이메일").evaluate((input) => input === document.activeElement)) {
      return
    }
    await page.keyboard.press("Tab")
  }
  throw new Error("Unable to focus login email.")
}
