import assert from "node:assert/strict"

import { authoringViewports } from "./constants.mjs"

export async function hideNextDevelopmentPortal(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
}

export async function captureAuthoringState({ evidenceDir, page, receipts, state }) {
  for (const viewport of authoringViewports) {
    await page.setViewportSize({ height: viewport.height, width: viewport.width })
    const heading = page.getByRole("heading", { name: "레슨 이미지" })
    await heading.scrollIntoViewIfNeeded()
    await settleVisibleMedia(page)
    const metrics = await readSectionMetrics(heading)
    assertVisualMetrics(metrics, state, viewport)
    const screenshot = `task-10-authoring-${state}-${viewport.name}.png`
    await page.screenshot({ animations: "disabled", path: `${evidenceDir}/${screenshot}` })
    receipts.push({
      ...metrics,
      screenshot,
      state,
      viewport: { height: viewport.height, width: viewport.width },
    })
  }
}

async function settleVisibleMedia(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(
      [...document.images]
        .filter((image) => image.offsetParent !== null)
        .map((image) => (image.complete ? undefined : image.decode())),
    )
  })
}

async function readSectionMetrics(heading) {
  return heading.locator("xpath=ancestor::section[1]").evaluate((section) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden"
    }
    const controls = [...section.querySelectorAll("button, label")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          height: rect.height,
          label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
          width: rect.width,
        }
      })
    const images = [...section.querySelectorAll("img")].filter(visible).map((image) => {
      const rect = image.getBoundingClientRect()
      return {
        alt: image.alt,
        complete: image.complete,
        height: rect.height,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        width: rect.width,
      }
    })
    const textOverflow = [...section.querySelectorAll("p, h2")]
      .filter(visible)
      .some((element) => element.scrollWidth > element.clientWidth + 1)
    const cards = [...section.querySelectorAll("[data-lesson-image-id]")]
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        }
      })
    return {
      cards,
      controls,
      documentScrollWidth: document.documentElement.scrollWidth,
      images,
      textOverflow,
      viewport: { height: innerHeight, width: innerWidth },
    }
  })
}

function assertVisualMetrics(metrics, state, viewport) {
  assert.equal(
    metrics.documentScrollWidth <= viewport.width,
    true,
    `${state} ${viewport.name} overflow`,
  )
  assert.equal(metrics.textOverflow, false, `${state} ${viewport.name} text overflow`)
  assert.equal(
    metrics.controls.every((control) => control.height >= 44 && control.width >= 44),
    true,
    `${state} ${viewport.name} 44px controls`,
  )
  assert.equal(
    metrics.images.every(
      (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    ),
    true,
    `${state} ${viewport.name} decoded images`,
  )
}
