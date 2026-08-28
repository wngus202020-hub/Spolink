import { createHash } from "node:crypto"
import { appendFile, chmod, mkdir } from "node:fs/promises"
import path from "node:path"
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test"
import { readProfileEditPngStats } from "./mypage-profile-edit-png"

type ProfileEditSuccessConfirmationReceipt = Readonly<{
  inViewport: true
  role: "status"
  state: "rendered"
  text: "프로필 정보를 저장했어요."
  visible: true
}>

type ProfileEditRegionValidationReceipt = Readonly<{
  ariaDescribedBy: true
  ariaInvalid: true
  errorId: "profile-edit-region-error"
  field: "defaultRegion"
  focusedSearchControl: true
  onlyFieldError: true
  text: "목록에서 기본 활동 지역을 선택해요."
  visible: true
}>

type ProfileEditScreenshotReceiptBase = Readonly<{
  bytes: number
  height: number
  layout: ProfileEditLayoutVerdict
  name: string
  nonBackgroundPixelCount: number
  sha256: string
  uniqueRgbCount: number
  width: number
}>

export type ProfileEditScreenshotReceipt =
  | (ProfileEditScreenshotReceiptBase &
      Readonly<{
        state: "success"
        successConfirmation: ProfileEditSuccessConfirmationReceipt
      }>)
  | (ProfileEditScreenshotReceiptBase &
      Readonly<{
        state: "legacy"
      }>)
  | (ProfileEditScreenshotReceiptBase &
      Readonly<{
        state: "validation"
        validationFeedback: ProfileEditRegionValidationReceipt
      }>)

export type ProfileEditLayoutVerdict = Readonly<{
  clippedText: readonly string[]
  focusedElement: string
  focusVisible: boolean
  horizontalOverflow: number
  overlappingControls: readonly string[]
}>

const expectedViewports: Record<string, Readonly<{ height: number; width: number }>> = {
  "desktop-chromium": { height: 800, width: 1280 },
  "mobile-chromium": { height: 844, width: 390 },
  "tablet-chromium": { height: 1024, width: 768 },
}

export async function captureProfileEditScreenshot({
  focusTarget,
  page,
  state,
  successConfirmation,
  testInfo,
}: Readonly<{
  focusTarget: Locator
  page: Page
  testInfo: TestInfo
}> &
  (
    | Readonly<{
        state: "success"
        successConfirmation: Locator
      }>
    | Readonly<{ state: "legacy"; successConfirmation?: never; validationFeedback?: never }>
    | Readonly<{
        state: "validation"
        successConfirmation?: never
        validationFeedback: true
      }>
  )): Promise<ProfileEditScreenshotReceipt> {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) throw new Error("SPOLINK_VISUAL_QA_DIR is required.")
  const expected = expectedViewports[testInfo.project.name]
  if (!expected) throw new Error(`Unexpected profile edit project: ${testInfo.project.name}`)

  await mkdir(visualQaDir, { mode: 0o700, recursive: true })
  await page.setViewportSize(expected)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content: [
      "html { scroll-behavior: auto !important; }",
      "nextjs-portal, [data-nextjs-dev-overlay] { display: none !important; }",
    ].join(" "),
  })
  if (state === "success") {
    await expect(successConfirmation).toHaveAttribute("role", "status")
    await expect(successConfirmation).toHaveText("프로필 정보를 저장했어요.")
    await expect(successConfirmation).toBeVisible()
  }
  if (state === "validation") {
    const error = page.locator("#profile-edit-region-error")
    await expect(error).toHaveText("목록에서 기본 활동 지역을 선택해요.")
    await expect(error).toBeVisible()
    await expect(focusTarget).toHaveAttribute("aria-invalid", "true")
    await expect(focusTarget).toHaveAttribute("aria-describedby", /profile-edit-region-error/u)
    await expect(page.getByText("활동 이름은 2자 이상 입력해요.")).toHaveCount(0)
    await expect(page.getByText("실명은 2자 이상 입력해요.")).toHaveCount(0)
    await expect(page.getByText("올바른 휴대폰 번호를 입력해요.")).toHaveCount(0)
  }
  await focusTarget.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" })
  })
  await focusTarget.focus()
  await expect(focusTarget).toBeFocused()
  const layout = await readProfileEditLayout(page)
  expect(layout.horizontalOverflow, "profile edit horizontal overflow").toBeLessThanOrEqual(0)
  expect(layout.clippedText, "profile edit clipped Korean/text nodes").toEqual([])
  expect(layout.overlappingControls, "profile edit overlapping controls").toEqual([])
  expect(layout.focusVisible, "profile edit visible focus").toBe(true)
  if (state === "success") await expect(successConfirmation).toBeInViewport()

  const name = `profile-edit-${state}-${testInfo.project.name}.png`
  const screenshotPath = path.join(visualQaDir, name)
  const screenshot = await page.screenshot({
    animations: "disabled",
    fullPage: false,
    mask: [
      page.getByLabel("활동 이름 (필수)"),
      page.getByLabel("실명 (필수)"),
      page.getByLabel("휴대폰 번호 (필수)"),
      page.locator('input[type="email"]'),
      page.locator("header, nav").getByText(/@/u),
      page.locator("header, nav").getByText(/^활동/u),
      page.getByText(/예: 010-1234-5678/u),
    ],
    maskColor: "#64748b",
    path: screenshotPath,
    scale: "css",
  })
  await chmod(screenshotPath, 0o600)
  const png = readProfileEditPngStats(screenshot)
  expect(png.width).toBe(expected.width)
  expect(png.height).toBe(expected.height)
  expect(png.nonBackgroundPixelCount, "profile edit nonblank pixels").toBeGreaterThan(1_000)
  expect(png.uniqueRgbCount, "profile edit unique colors").toBeGreaterThan(16)

  const receiptBase = {
    bytes: screenshot.byteLength,
    height: png.height,
    layout,
    name,
    nonBackgroundPixelCount: png.nonBackgroundPixelCount,
    sha256: createHash("sha256").update(screenshot).digest("hex"),
    uniqueRgbCount: png.uniqueRgbCount,
    width: png.width,
  } satisfies ProfileEditScreenshotReceiptBase
  const receipt =
    state === "success"
      ? ({
          ...receiptBase,
          state,
          successConfirmation: {
            inViewport: true,
            role: "status",
            state: "rendered",
            text: "프로필 정보를 저장했어요.",
            visible: true,
          },
        } satisfies ProfileEditScreenshotReceipt)
      : state === "validation"
        ? ({
            ...receiptBase,
            state,
            validationFeedback: {
              ariaDescribedBy: true,
              ariaInvalid: true,
              errorId: "profile-edit-region-error",
              field: "defaultRegion",
              focusedSearchControl: true,
              onlyFieldError: true,
              text: "목록에서 기본 활동 지역을 선택해요.",
              visible: true,
            },
          } satisfies ProfileEditScreenshotReceipt)
        : ({ ...receiptBase, state } satisfies ProfileEditScreenshotReceipt)
  await appendProfileEditObservation({
    project: testInfo.project.name,
    receipt,
    type: "screenshot",
  })
  return receipt
}

export async function appendProfileEditObservation(value: unknown): Promise<void> {
  const visualQaDir = process.env["SPOLINK_VISUAL_QA_DIR"]
  if (!visualQaDir) throw new Error("SPOLINK_VISUAL_QA_DIR is required.")
  const filePath = path.join(visualQaDir, "observations.jsonl")
  await mkdir(visualQaDir, { mode: 0o700, recursive: true })
  await appendFile(filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  await chmod(filePath, 0o600)
}

async function readProfileEditLayout(page: Page): Promise<ProfileEditLayoutVerdict> {
  return page.evaluate(() => {
    const textSelectors = [
      "main h1",
      "main h2",
      "main p",
      "main label",
      "main legend",
      "main button",
      "main span",
    ]
    const textNodes = Array.from(document.querySelectorAll(textSelectors.join(",")))
    const clippedText = textNodes
      .filter((element) => {
        if (element.closest(".sr-only") || element.getAttribute("aria-hidden") === "true") {
          return false
        }
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        return (
          rect.left < -0.5 ||
          rect.right > document.documentElement.clientWidth + 0.5 ||
          element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1
        )
      })
      .map((element) => element.textContent?.trim().slice(0, 40) || element.tagName)
    const controls = Array.from(document.querySelectorAll("main input, main button, main a"))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          label:
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 40) ||
            element.getAttribute("name") ||
            element.tagName,
          rect: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
        }
      })
      .filter((item) => item.rect.right > item.rect.left && item.rect.bottom > item.rect.top)
    const overlappingControls: string[] = []
    for (let firstIndex = 0; firstIndex < controls.length; firstIndex += 1) {
      const first = controls[firstIndex]
      if (!first) continue
      for (let secondIndex = firstIndex + 1; secondIndex < controls.length; secondIndex += 1) {
        const second = controls[secondIndex]
        if (!second) continue
        const xOverlap =
          Math.min(first.rect.right, second.rect.right) -
          Math.max(first.rect.left, second.rect.left)
        const yOverlap =
          Math.min(first.rect.bottom, second.rect.bottom) -
          Math.max(first.rect.top, second.rect.top)
        if (xOverlap > 2 && yOverlap > 2) {
          overlappingControls.push(`${first.label}/${second.label}`)
        }
      }
    }
    const active = document.activeElement
    const activeElement =
      active?.getAttribute("aria-label") ||
      active?.getAttribute("name") ||
      active?.id ||
      active?.tagName ||
      "none"
    const style = active ? getComputedStyle(active) : null
    return {
      clippedText,
      focusedElement: activeElement,
      focusVisible:
        style !== null &&
        (style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          style.borderColor !== "rgb(214, 219, 224)"),
      horizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overlappingControls,
    }
  })
}
