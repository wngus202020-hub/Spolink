import assert from "node:assert/strict"

import { ACTION_TIMEOUT_MS } from "../public-gallery-browser-qa-runtime.mjs"
import { GALLERY_STATES, PUBLIC_VIEWPORTS } from "./config.mjs"
import { openGalleryState, originalUrl, settleDom } from "./dom-metrics.mjs"
import { assertPrimary, capturePublicState, captureScreenshot } from "./screenshots.mjs"

export async function runPublicGalleryScenarios(context, page, signal) {
  for (const viewport of PUBLIC_VIEWPORTS) {
    await capturePublicState(context, page, "five", GALLERY_STATES.five, viewport)
  }
  await verifyThumbnailSelection(context, page)
  signal.throwIfAborted()
  await verifyListCoverOrder(context, page)
  signal.throwIfAborted()

  for (const key of ["zero", "one", "broken"]) {
    for (const viewport of PUBLIC_VIEWPORTS) {
      await capturePublicState(context, page, key, GALLERY_STATES[key], viewport)
    }
  }
  assertStableMediaBoxes(context.report)
  signal.throwIfAborted()
}

async function verifyThumbnailSelection(context, page) {
  const primary = page.locator('[data-lesson-gallery-primary="true"] img')
  const viewport = { height: 800, width: 1280 }
  await page.setViewportSize(viewport)
  await openGalleryState({
    fixture: context.fixture,
    key: "five",
    media: primary,
    page,
    resetViewport: false,
    state: GALLERY_STATES.five,
  })
  await page.locator('[data-lesson-gallery-thumbnail="1"]').click()
  await assertPrimary(page, 2)
  const selectedPrimaryBox = await primary.boundingBox()
  const third = page.locator('[data-lesson-gallery-thumbnail="2"]')
  await third.focus()
  await page.keyboard.press("Space")
  await assertPrimary(page, 3)
  assert.deepEqual(await primary.boundingBox(), selectedPrimaryBox)
  assert.equal(await third.getAttribute("aria-current"), "true")
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-lesson-gallery-thumbnail"),
    ),
    "2",
  )
  await captureScreenshot(
    context,
    page,
    "public-gallery-selected-image-3.png",
    viewport,
    primary,
    "five-selected",
  )
  context.report.scenarios.five = { keyboardSelected: 3, mouseSelected: 2, thumbnailCount: 5 }
}

async function verifyListCoverOrder(context, page) {
  await page.goto("/lessons", { waitUntil: "domcontentloaded" })
  const card = page.locator("article").filter({ hasText: GALLERY_STATES.five.title })
  await card.getByRole("heading", { name: GALLERY_STATES.five.title }).waitFor()
  await card.getByText("축구", { exact: true }).waitFor()
  await card.locator("img").first().waitFor()
  await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS })
  await settleDom(page)
  const listCoverUrl = await originalUrl(card.locator("img").first())
  const primary = page.locator('[data-lesson-gallery-primary="true"] img')
  await openGalleryState({
    fixture: context.fixture,
    key: "five",
    media: primary,
    page,
    state: GALLERY_STATES.five,
  })
  assert.equal(await originalUrl(primary), listCoverUrl)
  context.report.scenarios.listCoverOrder0 = true
}

function assertStableMediaBoxes(report) {
  for (const viewport of PUBLIC_VIEWPORTS) {
    const boxes = Object.keys(GALLERY_STATES).map(
      (state) => report.scenarios[`public-gallery-${state}-${viewport.name}.png`].mediaBox,
    )
    const [reference, ...rest] = boxes
    for (const box of rest) {
      assert.ok(Math.abs(box.width - reference.width) <= 1, `${viewport.name} media width drift`)
      assert.ok(Math.abs(box.height - reference.height) <= 1, `${viewport.name} media height drift`)
    }
  }
}
