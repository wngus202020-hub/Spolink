import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import path from "node:path"

import { validateBadgeRaster } from "../public-gallery-badge-raster.mjs"
import { validatePng } from "../public-gallery-browser-qa-runtime.mjs"
import {
  assertBadgeDomReceipt,
  assertCompositedState,
  openGalleryState,
  readBadgeDomReceipt,
  readPageMetrics,
  readTitleMetrics,
} from "./dom-metrics.mjs"

export async function capturePublicState(context, page, key, state, viewport) {
  await page.setViewportSize({ height: viewport.height, width: viewport.width })
  const media =
    state.mediaKind === "image"
      ? page.locator('[data-lesson-gallery-primary="true"] img')
      : page.locator('[data-lesson-media-state="missing"]')
  await openGalleryState({
    fixture: context.fixture,
    key,
    media,
    page,
    resetViewport: false,
    state,
  })
  if (key === "five") await assertPrimary(page, 1)
  const sportBadge = page.getByText("축구", { exact: true })
  await assertCompositedState(page, state.title, state.thumbnails, media)
  const titleMetrics = await readTitleMetrics(page, state.title)
  const focusTarget =
    state.thumbnails > 0
      ? page.locator('[data-lesson-gallery-thumbnail="0"]')
      : page.getByRole("link", { name: "레슨 목록" })
  await focusTarget.focus()
  const screenshot = `public-gallery-${key}-${viewport.name}.png`
  if (key === "one") {
    await captureBadgeEvidence(context, page, sportBadge, media, screenshot, viewport, titleMetrics)
  } else {
    await captureScreenshot(context, page, screenshot, viewport, media, key, titleMetrics)
  }
  context.report.viewports.push({
    height: viewport.height,
    screenshot,
    state: key,
    width: viewport.width,
  })
}

export async function captureScreenshot(context, page, name, viewport, media, state, titleMetrics) {
  const filePath = path.join(context.config.stagingDir, name)
  const metrics = await readPageMetrics(page)
  const mediaBox = await media.boundingBox()
  assert.ok(mediaBox, `${name} media box`)
  assert.equal(metrics.documentScrollWidth <= viewport.width, true, `${name} horizontal overflow`)
  assert.equal(metrics.textOverflow, false, `${name} text overflow`)
  assert.equal(
    metrics.controls.every((control) => control.height >= 44 && control.width >= 44),
    true,
    `${name} 44px gallery controls`,
  )
  assert.equal(
    metrics.images.every((image) => image.complete && image.naturalWidth > 0),
    true,
    `${name} decoded gallery images`,
  )
  assert.equal(metrics.focus.activeElement, true, `${name} active focus`)
  assert.equal(metrics.focus.focusVisible, true, `${name} visible focus`)
  assert.equal(metrics.focus.outlineStyle, "solid", `${name} focus outline`)
  assert.equal(metrics.focus.outlineWidth, "2px", `${name} focus outline width`)
  await page.screenshot({ animations: "disabled", path: filePath })
  const receipt = await validatePng(filePath, viewport.width, viewport.height)
  context.report.scenarios[name] = {
    ...receipt,
    composited: true,
    mediaBox,
    metrics,
    state,
    ...(titleMetrics ? { titleMetrics } : {}),
  }
  context.progress("screenshot-validated", { name })
}

export async function assertPrimary(page, position) {
  const primary = page.locator('[data-lesson-gallery-primary="true"] img')
  await primary.waitFor({ state: "visible" })
  assert.equal(await primary.getAttribute("alt"), `공개 갤러리 다섯 장 레슨 이미지 ${position}/5`)
}

async function captureBadgeEvidence(
  context,
  page,
  sportBadge,
  media,
  fullName,
  viewport,
  titleMetrics,
) {
  const clipName = `public-gallery-one-sport-badge-${viewport.name}.png`
  const domName = `public-gallery-one-badge-dom-${viewport.name}.json`
  const before = await readBadgeDomReceipt(sportBadge)
  assertBadgeDomReceipt(before)
  await captureScreenshot(context, page, fullName, viewport, media, "one", titleMetrics)
  const after = await readBadgeDomReceipt(sportBadge)
  assertBadgeDomReceipt(after)
  assert.deepEqual(after, before)
  const clipPath = path.join(context.config.stagingDir, clipName)
  await sportBadge.screenshot({ animations: "disabled", path: clipPath })
  const raster = await validateBadgeRaster({
    bounds: before.bounds,
    clipPath,
    colors: before.computed,
    fullPath: path.join(context.config.stagingDir, fullName),
    textRegion: before.textBounds,
  })
  await writeFile(
    path.join(context.config.stagingDir, domName),
    `${JSON.stringify({ after, before, raster }, null, 2)}\n`,
    { mode: 0o600 },
  )
  context.report.scenarios[fullName] = {
    ...context.report.scenarios[fullName],
    badgeDomStable: true,
    badgeRaster: raster,
  }
  context.progress("badge-raster-validated", { glyphPixels: raster.glyphPixels, name: fullName })
}
