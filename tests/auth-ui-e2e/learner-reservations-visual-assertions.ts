import { createHash } from "node:crypto"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test"

export type ScreenshotReceipt = Readonly<{
  bytes: number
  height: number
  name: string
  sha256: string
  state: "recovery" | "success"
  width: number
}>

type CompletionCapture = Readonly<{
  focusedAction: Locator
  page: Page
  secondaryAction: Locator
  state: "recovery" | "success"
  testInfo: TestInfo
}>

export async function captureReservationScreenshot(page: Page, projectName: string, label: string) {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) return
  await page.addStyleTag({
    content: "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await page.screenshot({
    fullPage: true,
    path: path.join(visualQaDir, `learner-reservations-${label}-${projectName}.png`),
  })
}

export async function captureCompletionScreenshot({
  focusedAction,
  page,
  secondaryAction,
  state,
  testInfo,
}: CompletionCapture): Promise<ScreenshotReceipt> {
  const visualQaDir = process.env["SPOLINK_TASK6_VISUAL_QA_DIR"]
  if (!visualQaDir) throw new Error("SPOLINK_TASK6_VISUAL_QA_DIR is required.")
  const viewport = testInfo.project.use.viewport
  if (!viewport) throw new Error("A fixed Playwright viewport is required.")
  const expectedHeight = viewport.width === 390 ? 844 : 900
  expect([390, 768, 1280]).toContain(viewport.width)
  await page.setViewportSize({ height: expectedHeight, width: viewport.width })
  expect(page.viewportSize()).toEqual({ height: expectedHeight, width: viewport.width })
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content:
      "html { scroll-behavior: auto !important; } nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
  await assertCompletionLayout(page)
  await assertRedactedRenderedText(page)
  const actionGroup = focusedAction.locator("xpath=..")
  const heroHeading = page.locator(
    state === "success" ? "#completion-title" : "#completion-recovery-title",
  )
  const summaryHint =
    state === "success"
      ? page.locator("#reservation-summary-title")
      : page.getByRole("alert").locator("p")
  await expect(focusedAction).toBeFocused()
  await expect(heroHeading).toBeInViewport({ ratio: 1 })
  await expect(focusedAction).toBeInViewport({ ratio: 1 })
  await expect(secondaryAction).toBeInViewport({ ratio: 1 })
  await expect(actionGroup).toBeInViewport({ ratio: 1 })
  await expect(summaryHint).toBeInViewport({ ratio: 1 })
  await expect(page.locator("a button, button a")).toHaveCount(0)
  const [actionGroupBox, viewportSize, focusedBackground, secondaryBackground] = await Promise.all([
    actionGroup.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
    focusedAction.evaluate((element) => getComputedStyle(element).backgroundColor),
    secondaryAction.evaluate((element) => getComputedStyle(element).backgroundColor),
  ])
  expect(actionGroupBox).not.toBeNull()
  expect(actionGroupBox?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect(actionGroupBox?.y ?? -1).toBeGreaterThanOrEqual(0)
  expect(
    (actionGroupBox?.x ?? viewportSize.width) + (actionGroupBox?.width ?? 0),
  ).toBeLessThanOrEqual(viewportSize.width)
  expect(
    (actionGroupBox?.y ?? viewportSize.height) + (actionGroupBox?.height ?? 0),
  ).toBeLessThanOrEqual(viewportSize.height)
  expect(focusedBackground).not.toBe(secondaryBackground)
  await expect.poll(() => layoutIsSettled(page)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1)
  await expect(heroHeading).toBeInViewport({ ratio: 1 })
  await expect(actionGroup).toBeInViewport({ ratio: 1 })
  await expect(summaryHint).toBeInViewport({ ratio: 1 })
  await expect(focusedAction).toBeFocused()
  const name = `completion-${state}-${viewport.width}.png`
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: path.join(visualQaDir, name),
    scale: "css",
  })
  await chmod(path.join(visualQaDir, name), 0o600)
  expect(screenshot.readUInt32BE(16)).toBe(viewport.width)
  expect(screenshot.readUInt32BE(20)).toBe(expectedHeight)
  return {
    bytes: screenshot.byteLength,
    height: expectedHeight,
    name,
    sha256: createHash("sha256").update(screenshot).digest("hex"),
    state,
    width: viewport.width,
  }
}

export async function focusByKeyboard(page: Page, target: Locator) {
  await page.locator("body").press("Home")
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((element) => element === document.activeElement)) break
  }
  await expect(target).toBeFocused()
}

async function assertCompletionLayout(page: Page) {
  const metrics = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("main h1, main h2, main nav a, main dt, main dd"),
    )
    const clipped = candidates
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
        return (
          rect.left < -0.5 ||
          rect.right > document.documentElement.clientWidth + 0.5 ||
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
        )
      })
      .map((element) => element.textContent?.trim().slice(0, 40) ?? element.tagName)
    return {
      clipped,
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(metrics.horizontalOverflow, "completion horizontal overflow").toBeLessThanOrEqual(0)
  expect(metrics.clipped, "completion clipped content").toEqual([])
}

async function assertRedactedRenderedText(page: Page) {
  const renderedText = await page.locator("body").innerText()
  expect(renderedText).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)
  expect(renderedText).not.toMatch(/01[016789]-?\d{3,4}-?\d{4}/u)
  expect(renderedText).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  )
  expect(renderedText).not.toContain("E2E")
  expect(renderedText).not.toContain("외부 학습자")
}

async function layoutIsSettled(page: Page) {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => {
          const before = window.scrollY
          requestAnimationFrame(() => resolve(Math.abs(window.scrollY - before) <= 1))
        })
      }),
  )
}
