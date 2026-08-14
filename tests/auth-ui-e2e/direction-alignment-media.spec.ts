import { expect, type Page, test } from "@playwright/test"

import { writeObservation } from "./direction-alignment-visual-helpers"

const tennisTitle = "퇴근 후 50분 테니스 입문"
const pilatesTitle = "체형 교정 필라테스 소그룹"

test("lesson media renders a real photo and falls back once after an aborted load", async ({
  page,
}, testInfo) => {
  // Given: console and page failures are observed, and one tennis photo request will be aborted.
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))

  await installRepeatedImageError(page, tennisTitle)

  let abortedPhotoRequests = 0
  await page.route("**/*", async (route) => {
    const url = route.request().url()
    if (url.includes("lesson-tennis.webp")) {
      abortedPhotoRequests += 1
      await route.abort("aborted")
      return
    }
    await route.continue()
  })

  // When: a fresh navigation loads one normal photo and receives the injected tennis image abort.
  await page.goto("/", { waitUntil: "networkidle" })
  const normalPhoto = page.getByAltText(pilatesTitle).first()
  await expect(normalPhoto).toBeVisible()
  await expect
    .poll(() =>
      normalPhoto.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true)
  const normalFrame = await normalPhoto.locator("xpath=..").boundingBox()
  expect(normalFrame).not.toBeNull()
  expect(normalFrame?.width && normalFrame.height / normalFrame.width).toBeCloseTo(0.75, 2)

  const missingMedia = page.getByRole("img", {
    name: `${tennisTitle} 대표 이미지 준비 중`,
  })
  await expect(missingMedia).toHaveCount(1)
  await expect(missingMedia).toBeVisible()
  const fallbackFrameBefore = await missingMedia.boundingBox()
  expect(fallbackFrameBefore).not.toBeNull()

  // When: the init hook dispatches a repeated error while the failed image is still mounted.
  expect(await page.evaluate(() => window.__spolinkRepeatedLoadError)).toBe(true)
  const fallbackFrameAfter = await missingMedia.boundingBox()

  // Then: one non-broken missing state remains in the same 4:3 frame with no console error.
  expect(abortedPhotoRequests).toBeGreaterThan(0)
  await expect(missingMedia).toHaveCount(1)
  expect(fallbackFrameAfter).toEqual(fallbackFrameBefore)
  expect(
    fallbackFrameAfter?.width && fallbackFrameAfter.height / fallbackFrameAfter.width,
  ).toBeCloseTo(0.75, 2)
  await expect(page.getByAltText(tennisTitle)).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])

  await writeObservation({
    consoleErrors,
    intentionalImageAbortCount: abortedPhotoRequests,
    page,
    pageErrors,
    route: "/#lesson-media-abort",
    screenshotName: "lesson-media-fallback.png",
    stateId: "media-home-mixed",
    testInfo,
    requirePhotoPixels: true,
  })
})

test("lesson detail renders a real photo in its stable shared-media frame", async ({
  page,
}, testInfo) => {
  // Given: a demo lesson with a valid local photo.
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))

  // When: the lesson detail page renders through the shared media component.
  await page.goto("/lessons/pilates-songpa", { waitUntil: "networkidle" })
  const photo = page.getByAltText(pilatesTitle)
  await expect(photo).toBeVisible()
  await expect
    .poll(() =>
      photo.evaluate(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true)

  // Then: the detail photo remains 4:3 with no broken-image or runtime error.
  const frame = await photo.locator("xpath=..").boundingBox()
  expect(frame).not.toBeNull()
  expect(frame?.width && frame.height / frame.width).toBeCloseTo(0.75, 2)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  await writeObservation({
    consoleErrors,
    page,
    pageErrors,
    route: "/lessons/pilates-songpa#lesson-media-photo",
    screenshotName: "lesson-detail-photo.png",
    stateId: "media-detail-photo",
    testInfo,
    requirePhotoPixels: true,
  })
})

test("lesson detail falls back once after an aborted and repeated image error", async ({
  page,
}, testInfo) => {
  // Given: the detail photo request is aborted and a second load error is injected.
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => pageErrors.push(error.message))
  await installRepeatedImageError(page, tennisTitle)
  let abortedPhotoRequests = 0
  await page.route("**/*", async (route) => {
    if (route.request().url().includes("lesson-tennis.webp")) {
      abortedPhotoRequests += 1
      await route.abort("aborted")
      return
    }
    await route.continue()
  })

  // When: the affected lesson detail page loads.
  await page.goto("/lessons/tennis-gangnam", { waitUntil: "networkidle" })
  const missingMedia = page.getByRole("img", {
    name: `${tennisTitle} 대표 이미지 준비 중`,
  })
  await expect(missingMedia).toHaveCount(1)
  await expect(missingMedia).toBeVisible()

  // Then: the shared detail boundary exposes one stable 4:3 missing state without an error loop.
  const frame = await missingMedia.boundingBox()
  expect(frame).not.toBeNull()
  expect(frame?.width && frame.height / frame.width).toBeCloseTo(0.75, 2)
  expect(abortedPhotoRequests).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__spolinkRepeatedLoadError)).toBe(true)
  await expect(page.getByAltText(tennisTitle)).toHaveCount(0)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
  await writeObservation({
    consoleErrors,
    intentionalImageAbortCount: abortedPhotoRequests,
    page,
    pageErrors,
    route: "/lessons/tennis-gangnam#lesson-media-abort",
    screenshotName: "lesson-detail-fallback.png",
    stateId: "media-detail-load-error",
    testInfo,
  })
})

async function installRepeatedImageError(page: Page, title: string) {
  await page.addInitScript((expectedTitle) => {
    let repeatedLoadError = false
    window.addEventListener(
      "error",
      (event) => {
        const target = event.target
        if (
          repeatedLoadError ||
          !(target instanceof HTMLImageElement) ||
          target.alt !== expectedTitle
        ) {
          return
        }
        repeatedLoadError = true
        target.dispatchEvent(new Event("error"))
      },
      true,
    )
    Object.defineProperty(window, "__spolinkRepeatedLoadError", {
      get: () => repeatedLoadError,
    })
  }, title)
}

declare global {
  interface Window {
    __spolinkRepeatedLoadError?: boolean
  }
}
