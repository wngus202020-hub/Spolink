import assert from "node:assert/strict"

import { assertFocusVisible, readFocusState } from "./focus.mjs"
import { captureAuthoringState, hideNextDevelopmentPortal } from "./visual-capture.mjs"

export async function runSubmissionScenario(harness) {
  const { fixture, page, viewportReceipts } = harness
  await page.setViewportSize({ height: 844, width: 390 })
  const reviewButton = page.getByRole("button", { name: "검토 요청" })
  await page.getByRole("button", { name: "임시 저장" }).focus()
  await page.keyboard.press("Tab")
  const mobileFocusState = await readFocusState(reviewButton)
  assertFocusVisible(mobileFocusState, "mobile review button")
  await hideNextDevelopmentPortal(page)
  await page.screenshot({ fullPage: true, path: `${fixture.evidenceDir}/task-7-focus-mobile.png` })

  await reviewButton.click()
  await page.waitForURL(/\/coach\/lessons$/u)
  await page.goto(`/coach/lessons/${fixture.getLessonId()}/edit`)
  await page.getByText("읽기 전용", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("레슨 제목").isDisabled(), true)
  assert.equal(await page.getByLabel("레슨 이미지 추가").isDisabled(), true)
  assert.equal(await page.getByRole("button", { name: "이미지 삭제" }).count(), 0)
  await captureAuthoringState({
    evidenceDir: fixture.evidenceDir,
    page,
    receipts: viewportReceipts,
    state: "read-only",
  })
  await page.setViewportSize({ height: 844, width: 390 })
  await hideNextDevelopmentPortal(page)
  await page.screenshot({
    fullPage: true,
    path: `${fixture.evidenceDir}/task-7-readonly-mobile.png`,
  })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true)
  return mobileFocusState
}
