import "./auth-accessibility-security.spec"
import "./auth-signup-reset.spec"
import "./auth-update-password.spec"
import "./auth-login.spec"

import { expect, test } from "@playwright/test"
import { mockRecoveryStart, submitCurrentFormTwice, testEmail } from "./auth-form-helpers"

test("reset recovers from an aborted request with focus and preserved email", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "reset-abort-retry")
  const recovery = await mockRecoveryStart(page, ["abort", "accepted"])

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(email)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  const alert = page.locator("form").getByRole("alert")
  await expect(alert).toBeFocused()
  await expect(alert).not.toContainText("provider")
  await expect(page.getByLabel("이메일")).toHaveValue(email)
  await expect(page.getByRole("button", { name: /재설정 안내 받기/ })).toBeEnabled()

  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  await expect(page.getByRole("status")).toBeVisible()
  expect(recovery.count()).toBe(2)
})

test("reset recovers from a malformed 502 response and only 2xx enters sent state", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "reset-502-retry")
  const recovery = await mockRecoveryStart(page, ["malformed-502", "accepted"])

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(email)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  const alert = page.locator("form").getByRole("alert")
  await expect(alert).toBeFocused()
  await expect(alert).not.toContainText("upstream provider detail")
  await expect(page.getByLabel("이메일")).toHaveValue(email)
  await expect(page.getByRole("button", { name: /재설정 안내 받기/ })).toBeEnabled()

  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  await expect(page.getByRole("status")).toBeVisible()
  expect(recovery.count()).toBe(2)
})

test("reset suppresses duplicate submit while the first request is pending", async ({
  page,
}, testInfo) => {
  const recovery = await mockRecoveryStart(page, ["pending"])

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(testEmail(testInfo, "reset-pending-duplicate"))

  try {
    await submitCurrentFormTwice(page)
    await expect.poll(recovery.count).toBe(1)
    await expect(page.getByRole("button", { name: /재설정 안내 받기/ })).toBeDisabled()
  } finally {
    await recovery.releasePending()
  }

  await expect(page.getByRole("status")).toBeVisible()
})

test("reset times out a hung request and restores the retry controls", async ({
  page,
}, testInfo) => {
  const email = testEmail(testInfo, "reset-hung-timeout")
  const recovery = await mockRecoveryStart(page, ["pending"])

  await page.goto("/auth/reset-password")
  await page.getByLabel("이메일").fill(email)
  await page.getByRole("button", { name: /재설정 안내 받기/ }).click()

  try {
    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toBeFocused({ timeout: 15_000 })
    await expect(page.getByLabel("이메일")).toHaveValue(email)
    await expect(page.getByRole("button", { name: /재설정 안내 받기/ })).toBeEnabled()
    expect(recovery.count()).toBe(1)
  } finally {
    await recovery.releasePending()
  }
})

test("known and unknown reset emails render identical success DOM and copy", async ({
  page,
}, testInfo) => {
  const recovery = await mockRecoveryStart(page)
  const successMarkup: string[] = []

  for (const label of ["known-reset-dom", "unknown-reset-dom"] as const) {
    await page.goto("/auth/reset-password")
    await page.getByLabel("이메일").fill(testEmail(testInfo, label))
    await page.getByRole("button", { name: /재설정 안내 받기/ }).click()
    successMarkup.push(await page.getByRole("status").evaluate((element) => element.outerHTML))
  }

  expect(successMarkup).toHaveLength(2)
  expect(successMarkup[0]).toBe(successMarkup[1])
  expect(recovery.count()).toBe(2)
})
