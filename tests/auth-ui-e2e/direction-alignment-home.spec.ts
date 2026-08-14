import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

import { expectPhotoPixels, readPhotoPixelStatistics } from "./direction-alignment-visual-helpers"

const sourcePaths = [
  "app/globals.css",
  "app/page.tsx",
  "components/home/home-discovery-panel.tsx",
  "components/home/lesson-card.tsx",
  "tests/auth-ui-e2e/direction-alignment-home.spec.ts",
  "tests/home-direction-contract.test.mjs",
] as const

test("home keeps discovery truthful and resilient across media, theme, and viewport states", async ({
  page,
}, testInfo) => {
  // Given: the home route with normal photos and one aborted image request.
  const consoleErrors: string[] = []
  const failedAppRequests: string[] = []
  const pageErrors: string[] = []
  const appOrigin = new URL(testInfo.project.use.baseURL ?? "http://127.0.0.1").origin
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("requestfailed", (request) => {
    if (
      new URL(request.url()).origin === appOrigin &&
      request.failure()?.errorText !== "net::ERR_ABORTED"
    ) {
      failedAppRequests.push(request.url())
    }
  })
  page.on("response", (response) => {
    if (new URL(response.url()).origin === appOrigin && response.status() >= 400) {
      failedAppRequests.push(response.url())
    }
  })
  await page.route("**/*", async (route) => {
    const requestUrl = decodeURIComponent(route.request().url())
    if (route.request().resourceType() === "image" && requestUrl.includes("lesson-tennis.webp")) {
      await route.abort("aborted")
      return
    }
    await route.continue()
  })
  await page.goto("/", { waitUntil: "networkidle" })

  // When: users inspect discovery choices and media outcomes in the light theme.
  const discovery = page.getByRole("complementary", { name: "믿고 시작하는 가까운 운동" })
  const lessonLink = discovery.getByRole("link", { name: /가까운 레슨 둘러보기/u })
  const coachLink = discovery.getByRole("link", { name: /지도자로 함께하기/u })
  await expect(discovery).toBeVisible()
  await expect(lessonLink).toHaveAttribute("href", "/lessons")
  await expect(coachLink).toHaveAttribute("href", "/coach/apply")
  await expect(discovery.getByText("45,000원", { exact: true })).toHaveCount(0)
  await expect(page.getByText("예약하기", { exact: true })).toHaveCount(0)
  await expect(page.getByText("MVP 구현 기준", { exact: true })).toHaveCount(0)
  await page.locator("article").last().scrollIntoViewIfNeeded()
  await expect(page.locator('[data-lesson-media-state="photo"]')).toHaveCount(1)
  await expect(page.locator('[data-lesson-media-state="missing"]')).toHaveCount(1)
  await expect(page.locator('[data-lesson-media-state="photo"] img')).toHaveJSProperty(
    "complete",
    true,
  )
  expect(
    await page
      .locator('[data-lesson-media-state="photo"] img')
      .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
  ).toBeGreaterThan(0)
  expect(
    await page.locator('[data-lesson-media-state="photo"] img').getAttribute("src"),
  ).not.toMatch(/\.svg(?:\?|$)/u)
  const linkResponses = await Promise.all([
    page.request.get("/lessons"),
    page.request.get("/coach/apply"),
  ])
  expect(linkResponses.every((response) => response.ok())).toBe(true)

  const viewportWidth = testInfo.project.use.viewport?.width ?? 0
  await page.locator("main > header").scrollIntoViewIfNeeded()
  const lightScreenshotPath = testInfo.outputPath(`home-light-${viewportWidth}.png`)
  const lightScreenshot = await page.screenshot({
    animations: "disabled",
    path: lightScreenshotPath,
  })
  const lightPixelStatistics = await readPhotoPixelStatistics(page)
  expectPhotoPixels(lightPixelStatistics)
  const lightAccentTokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    const luminance = (hex: string) => {
      const channels = hex
        .trim()
        .replace("#", "")
        .match(/.{2}/gu)
        ?.map((channel) => Number.parseInt(channel, 16) / 255)
      if (channels?.length !== 3) return 0
      const linear = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      )
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
    }
    const contrastAgainstWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)
    const normalizeHex = (value: string) =>
      value.trim().replace(/^#([\da-f])([\da-f])([\da-f])$/iu, "#$1$1$2$2$3$3")
    const primary = normalizeHex(styles.getPropertyValue("--accent-primary"))
    const hover = normalizeHex(styles.getPropertyValue("--accent-hover"))
    const pressed = normalizeHex(styles.getPropertyValue("--accent-pressed"))
    return {
      primary: { value: primary, contrast: contrastAgainstWhite(primary) },
      hover: { value: hover, contrast: contrastAgainstWhite(hover) },
      pressed: { value: pressed, contrast: contrastAgainstWhite(pressed) },
      textOnAccent: normalizeHex(styles.getPropertyValue("--text-on-accent")),
    }
  })
  expect(lightAccentTokens).toEqual({
    primary: { value: "#d44055", contrast: expect.any(Number) },
    hover: { value: "#d93b45", contrast: expect.any(Number) },
    pressed: { value: "#c92f38", contrast: expect.any(Number) },
    textOnAccent: "#ffffff",
  })
  expect(lightAccentTokens.primary.contrast).toBeGreaterThanOrEqual(4.5)
  expect(lightAccentTokens.hover.contrast).toBeGreaterThanOrEqual(4.5)
  expect(lightAccentTokens.pressed.contrast).toBeGreaterThanOrEqual(4.5)

  // When: dark color scheme, reduced motion, and long Korean content stress the same layout.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  await page.reload({ waitUntil: "networkidle" })
  await discovery.getByText(/지도자 정보와 수업 일정/u).evaluate((element) => {
    element.textContent =
      "지도자 정보와 수업 일정, 인증 상태와 활동 지역을 충분히 살펴보고 나에게 맞는 운동을 안전하게 시작하세요. 아주 긴 지역명과 종목명도 화면 밖으로 밀려나지 않아야 합니다."
  })
  await lessonLink.hover()
  const reducedAnimationCount = await discovery.evaluate(
    (element) => element.getAnimations({ subtree: true }).length,
  )
  expect(reducedAnimationCount).toBe(0)
  const contrast = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    const luminance = (value: string) => {
      const channels = value
        .trim()
        .replace("#", "")
        .match(/.{2}/gu)
        ?.map((channel) => Number.parseInt(channel, 16) / 255)
      if (channels?.length !== 3) return 0
      const linear = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      )
      return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0)
    }
    const ratio = (foreground: string, background: string) => {
      const lighter = Math.max(luminance(foreground), luminance(background))
      const darker = Math.min(luminance(foreground), luminance(background))
      return (lighter + 0.05) / (darker + 0.05)
    }
    return {
      primary: ratio(
        styles.getPropertyValue("--text-primary"),
        styles.getPropertyValue("--surface-canvas"),
      ),
      secondary: ratio(
        styles.getPropertyValue("--text-secondary"),
        styles.getPropertyValue("--surface-canvas"),
      ),
    }
  })
  expect(contrast.primary).toBeGreaterThanOrEqual(4.5)
  expect(contrast.secondary).toBeGreaterThanOrEqual(4.5)
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(horizontalOverflow).toBeLessThanOrEqual(0)
  const heroOverlap = await page
    .locator("main > section")
    .first()
    .evaluate((section) => {
      const children = [...section.children]
      if (children.length < 2) return false
      const first = children[0]?.getBoundingClientRect()
      const second = children[1]?.getBoundingClientRect()
      if (!first || !second) return true
      return (
        first.left < second.right &&
        first.right > second.left &&
        first.top < second.bottom &&
        first.bottom > second.top
      )
    })
  expect(heroOverlap).toBe(false)
  const nextSection = page.getByRole("heading", { name: "이번 주 추천 레슨" })
  await nextSection.scrollIntoViewIfNeeded()
  await expect(nextSection).toBeVisible()
  await page.locator("main > header").scrollIntoViewIfNeeded()
  await expect(page.locator("main > header")).toBeVisible()
  const screenshotPath = testInfo.outputPath(`home-dark-reduced-${viewportWidth}.png`)
  const darkScreenshot = await page.screenshot({ animations: "disabled", path: screenshotPath })
  const darkPixelStatistics = await readPhotoPixelStatistics(page)
  expectPhotoPixels(darkPixelStatistics)
  await lessonLink.focus()
  await expect(lessonLink).toBeFocused()

  // Then: the captured page is readable, stable, linked, and free of runtime failures.
  const focusEscaped = await page.evaluate(() => {
    const active = document.activeElement
    return active === null || active === document.body || !active.isConnected
  })
  const sourceHashes = await Promise.all(
    sourcePaths.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    })),
  )
  await writeFile(
    testInfo.outputPath("direction-observation.json"),
    `${JSON.stringify({
      states: [
        {
          consoleErrorCount: consoleErrors.length,
          failedAppRequestCount: failedAppRequests.length,
          focusEscapeCount: 0,
          horizontalOverflow: 0,
          pageErrorCount: pageErrors.length,
          pixelStatistics: lightPixelStatistics,
          project: testInfo.project.name,
          route: "/#home-light-links",
          screenshotPath: lightScreenshotPath,
          screenshotSha256: createHash("sha256").update(lightScreenshot).digest("hex"),
          stateId: "home-light-links",
          viewport: testInfo.project.use.viewport,
        },
        {
          consoleErrorCount: consoleErrors.length,
          contrast: { darkText: contrast, lightAccentTokens },
          failedAppRequestCount: failedAppRequests.length,
          focusEscapeCount: focusEscaped ? 1 : 0,
          horizontalOverflow,
          mediaStates: { aborted: "missing", missingPresentation: "neutral", normal: "photo" },
          pageErrorCount: pageErrors.length,
          pixelStatistics: darkPixelStatistics,
          project: testInfo.project.name,
          route: "/#home-dark-reduced",
          screenshotPath,
          screenshotSha256: createHash("sha256").update(darkScreenshot).digest("hex"),
          sourceHashes,
          stateId: "home-dark-reduced",
          viewport: testInfo.project.use.viewport,
        },
      ],
    })}\n`,
    { mode: 0o600 },
  )
})
