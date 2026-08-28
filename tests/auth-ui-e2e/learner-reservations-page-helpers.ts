import { expect, type Page, test } from "@playwright/test"

export type PhaseReceipt = Readonly<{
  durationMs: number
  name: string
  status: "failed" | "passed"
}>

export async function runReservationPhase<T>(
  phases: PhaseReceipt[],
  name: string,
  action: () => Promise<T>,
) {
  const startedAt = Date.now()
  try {
    const result = await test.step(name, action)
    phases.push({ durationMs: Date.now() - startedAt, name, status: "passed" })
    return result
  } catch (error) {
    phases.push({ durationMs: Date.now() - startedAt, name, status: "failed" })
    throw error
  }
}

export function safePathname(url: string) {
  return new URL(url).pathname.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu,
    "[id]",
  )
}

export async function assertReservationFilter(
  page: Page,
  linkName: string,
  status: string,
  expectedRows: number,
  expectedStatus: string,
) {
  await page.getByRole("link", { exact: true, name: linkName }).click()
  await expect(page).toHaveURL(new RegExp(`/mypage/reservations\\?status=${status}$`, "u"))
  await expect(page.locator("article")).toHaveCount(expectedRows)
  await expect(page.getByText(expectedStatus).first()).toBeVisible()
}
