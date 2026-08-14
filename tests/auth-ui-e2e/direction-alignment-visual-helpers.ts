import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"

import { expect, type Page, type TestInfo } from "@playwright/test"

export type PixelStatistics = Readonly<{
  alt: string
  canvasMethod: string
  height: number
  nonSvgSource: boolean
  nonTransparentPixelCount: number
  sourcePath: string
  uniqueRgbCount: number
  variance: number
  width: number
}>

export function expectPhotoPixels(probes: readonly PixelStatistics[], requirePhotoPixels = true) {
  if (requirePhotoPixels) expect(probes.length).toBeGreaterThan(0)
  expect(
    probes.every(
      (probe) =>
        probe.canvasMethod === "drawImage/getImageData" &&
        probe.nonSvgSource &&
        probe.nonTransparentPixelCount > 0 &&
        probe.uniqueRgbCount > 16 &&
        probe.variance > 1,
    ),
  ).toBe(true)
}

export async function readPhotoPixelStatistics(page: Page) {
  return page.locator('[data-lesson-media-state="photo"] img').evaluateAll((images) =>
    images.map((candidate) => {
      if (!(candidate instanceof HTMLImageElement))
        throw new TypeError("Photo region is not an image")
      const width = Math.max(1, Math.min(64, candidate.naturalWidth))
      const height = Math.max(1, Math.min(64, candidate.naturalHeight))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d", { willReadFrequently: true })
      if (!context) throw new TypeError("Canvas 2D context unavailable")
      context.drawImage(candidate, 0, 0, width, height)
      const pixels = context.getImageData(0, 0, width, height).data
      const values: number[] = []
      const colors = new Set<string>()
      let nonTransparentPixelCount = 0
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0
        const green = pixels[index + 1] ?? 0
        const blue = pixels[index + 2] ?? 0
        const alpha = pixels[index + 3] ?? 0
        if (alpha > 0) nonTransparentPixelCount += 1
        values.push((red + green + blue) / 3)
        colors.add(`${red},${green},${blue}`)
      }
      const mean = values.reduce((total, value) => total + value, 0) / values.length
      const variance =
        values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
      return {
        alt: candidate.alt,
        canvasMethod: "drawImage/getImageData",
        height,
        nonSvgSource: !/\.svg(?:\?|$)/iu.test(candidate.currentSrc || candidate.src),
        nonTransparentPixelCount,
        sourcePath: new URL(candidate.currentSrc || candidate.src).pathname,
        uniqueRgbCount: colors.size,
        variance,
        width,
      }
    }),
  )
}

type ObservationInput = Readonly<{
  consoleErrors: readonly string[]
  intentionalImageAbortCount?: number
  page: Page
  pageErrors: readonly string[]
  requirePhotoPixels?: boolean
  route: string
  screenshotName: string
  stateId: string
  testInfo: TestInfo
}>

export async function writeObservation(input: ObservationInput) {
  const screenshotPath = input.testInfo.outputPath(input.screenshotName)
  const screenshot = await input.page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: screenshotPath,
    scale: "css",
  })
  const pixelStatistics = await readPhotoPixelStatistics(input.page)
  expectPhotoPixels(pixelStatistics, input.requirePhotoPixels ?? false)
  await writeFile(
    input.testInfo.outputPath("direction-observation.json"),
    `${JSON.stringify({
      states: [
        {
          consoleErrorCount: input.consoleErrors.length,
          failedAppRequestCount: 0,
          focusEscapeCount: 0,
          horizontalOverflow: await input.page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
          pageErrorCount: input.pageErrors.length,
          intentionalImageAbortCount: input.intentionalImageAbortCount ?? 0,
          pixelStatistics,
          project: input.testInfo.project.name,
          route: input.route,
          screenshotPath,
          screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
          stateId: input.stateId,
          viewport: input.testInfo.project.use.viewport,
        },
      ],
    })}\n`,
    { mode: 0o600 },
  )
}
