import { chmod, mkdir } from "node:fs/promises"
import path from "node:path"
import { expect, type Locator, type Page } from "@playwright/test"

export type ReviewVisualState = "empty" | "loading" | "populated" | "read-failure"
export type ReviewVisualTheme = "dark" | "light"

type CaptureInput = Readonly<{
  content: Record<string, true> | null
  height: number
  name: string
  page: Page
  prepared?: boolean
  recovery: Record<string, true> | null
  state: ReviewVisualState
  theme: ReviewVisualTheme
  width: number
}>

export async function captureMypageReviewsVisual(input: CaptureInput) {
  const stagingDir = process.env["SPOLINK_MYPAGE_REVIEWS_VISUAL_STAGING_DIR"]
  if (!stagingDir) throw new Error("SPOLINK_MYPAGE_REVIEWS_VISUAL_STAGING_DIR is required.")
  if (!input.prepared) await prepareMypageReviewsVisualPage(input)
  await expect(input.page.locator("main")).toBeVisible()
  expect(await input.page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(
    input.theme === "dark",
  )

  const focusTarget = selectFocusTarget(input.page, input.state)
  let focusVisible = true
  if (focusTarget) {
    await focusByKeyboard(input.page, focusTarget)
    focusVisible = await hasVisibleFocus(focusTarget)
    expect(focusVisible, `visible keyboard focus for ${input.name}`).toBe(true)
  }
  const layout = await readLayout(input.page)
  expect(layout.horizontalOverflow, `horizontal overflow for ${input.name}`).toBeLessThanOrEqual(0)
  expect(layout.overlaps, `overlap findings for ${input.name}`).toEqual([])
  expect(layout.cjkClipping, `CJK clipping for ${input.name}`).toEqual([])
  expect(layout.minimumTargetHeight, `target height for ${input.name}`).toBeGreaterThanOrEqual(44)
  expect(layout.minimumTargetWidth, `target width for ${input.name}`).toBeGreaterThanOrEqual(44)
  expect(layout.semanticColors, `semantic colors for ${input.name}`).toBe(true)

  await mkdir(stagingDir, { mode: 0o700, recursive: true })
  const screenshotPath = path.join(stagingDir, input.name)
  const bytes = await input.page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: screenshotPath,
    scale: "css",
  })
  await chmod(screenshotPath, 0o600)
  if (input.state === "loading") {
    await expect(input.page.locator('main[aria-busy="true"]')).toBeVisible()
    await expect(input.page.getByText("리뷰 내역을 불러오지 못했어요")).toHaveCount(0)
  }
  expect(bytes.readUInt32BE(16)).toBe(input.width)
  expect(bytes.readUInt32BE(20)).toBe(input.height)
  return {
    capturedAt: new Date().toISOString(),
    content: input.content,
    geometry: layout.geometry,
    height: input.height,
    layout: { ...layout, focusVisible },
    name: input.name,
    recovery: input.recovery,
    state: input.state,
    theme: input.theme,
    width: input.width,
  }
}

export async function prepareMypageReviewsVisualPage(
  input: Readonly<{ height: number; page: Page; theme: ReviewVisualTheme; width: number }>,
): Promise<void> {
  await input.page.setViewportSize({ height: input.height, width: input.width })
  await input.page.emulateMedia({ colorScheme: input.theme })
  await input.page.evaluate(() => document.fonts.ready)
  await input.page.addStyleTag({
    content:
      "html { scroll-behavior: auto !important; } nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
  })
}

function selectFocusTarget(page: Page, state: ReviewVisualState): Locator | null {
  if (state === "loading") return null
  if (state === "populated") {
    return page
      .getByRole("region", { name: "리뷰 내역" })
      .getByRole("link", { name: "리뷰 내역 활성 레슨" })
      .first()
  }
  if (state === "empty") return page.getByRole("link", { name: "예약 내역 보기" })
  return page.getByRole("link", { name: "마이페이지" })
}

async function focusByKeyboard(page: Page, target: Locator): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    window.scrollTo(0, 0)
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await page.keyboard.press("Tab")
    if (await target.evaluate((element) => element === document.activeElement)) break
  }
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
}

async function hasVisibleFocus(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const style = getComputedStyle(element)
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2
  })
}

async function readLayout(page: Page) {
  return page.evaluate(() => {
    const scope = document.querySelector("main > section")
    if (!(scope instanceof HTMLElement)) throw new Error("Review visual scope is missing.")
    const candidates = [...scope.querySelectorAll("h1,h2,h3,p,time,a,button,[role='img']")].filter(
      (element) => {
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && !element.closest(".sr-only")
      },
    )
    const cjkClipping = candidates
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        const text = element.textContent?.trim() ?? ""
        return (
          /[가-힣]/u.test(text) &&
          (rect.left < -0.5 ||
            rect.right > document.documentElement.clientWidth + 0.5 ||
            element.scrollWidth > element.clientWidth + 1 ||
            element.scrollHeight > element.clientHeight + 1)
        )
      })
      .map((element) => element.textContent?.trim().slice(0, 60) ?? element.tagName)
    const boxes = candidates.map((element) => {
      const rect = element.getBoundingClientRect()
      return { element, label: element.textContent?.trim().slice(0, 40) ?? element.tagName, rect }
    })
    const overlaps: string[] = []
    for (let firstIndex = 0; firstIndex < boxes.length; firstIndex += 1) {
      const first = boxes[firstIndex]
      if (!first) continue
      for (let secondIndex = firstIndex + 1; secondIndex < boxes.length; secondIndex += 1) {
        const second = boxes[secondIndex]
        if (
          !second ||
          first.element.contains(second.element) ||
          second.element.contains(first.element)
        )
          continue
        const x =
          Math.min(first.rect.right, second.rect.right) -
          Math.max(first.rect.left, second.rect.left)
        const y =
          Math.min(first.rect.bottom, second.rect.bottom) -
          Math.max(first.rect.top, second.rect.top)
        if (x > 2 && y > 2) overlaps.push(`${first.label}/${second.label}`)
      }
    }
    const targets = [...scope.querySelectorAll("a,button,input,select,textarea")]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    const rootStyle = getComputedStyle(document.documentElement)
    const requiredTokens = [
      "--surface-canvas",
      "--surface-subtle",
      "--text-primary",
      "--text-secondary",
      "--border-default",
      "--accent-primary",
      "--status-warning",
    ]
    const scopeRect = scope.getBoundingClientRect()
    return {
      cjkClipping,
      geometry: {
        contentLeft: Math.round(scopeRect.left * 100) / 100,
        contentTop: Math.round(scopeRect.top * 100) / 100,
        contentWidth: Math.round(scopeRect.width * 100) / 100,
      },
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minimumTargetHeight:
        targets.length === 0 ? 44 : Math.min(...targets.map((rect) => rect.height)),
      minimumTargetWidth:
        targets.length === 0 ? 44 : Math.min(...targets.map((rect) => rect.width)),
      overlaps,
      semanticColors:
        requiredTokens.every((token) => rootStyle.getPropertyValue(token).trim().length > 0) &&
        !candidates.some((element) =>
          element.getAttribute("style")?.match(/(?:color|background)/u),
        ),
    }
  })
}
