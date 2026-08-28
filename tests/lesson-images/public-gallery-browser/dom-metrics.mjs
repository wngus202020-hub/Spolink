import assert from "node:assert/strict"

import { ACTION_TIMEOUT_MS } from "../public-gallery-browser-qa-runtime.mjs"

export async function openGalleryState({ fixture, key, media, page, resetViewport = true, state }) {
  if (resetViewport) await page.setViewportSize({ height: 844, width: 390 })
  await page.goto(`/lessons/${fixture.lessonIds[key]}`, { waitUntil: "domcontentloaded" })
  await waitForSettledPage(page, state.title, state.thumbnails, media)
}

export async function waitForSettledPage(page, title, thumbnails, media) {
  await page.getByRole("heading", { level: 1, name: title }).waitFor({ state: "visible" })
  await page.getByText("축구", { exact: true }).waitFor({ state: "visible" })
  await media.waitFor({ state: "visible" })
  assert.equal(await page.locator("[data-lesson-gallery-thumbnail]").count(), thumbnails)
  await page.waitForLoadState("networkidle", { timeout: ACTION_TIMEOUT_MS })
  await settleDom(page)
  await assertCompositedState(page, title, thumbnails, media)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
}

export async function assertCompositedState(page, title, thumbnails, media) {
  for (let pass = 0; pass < 2; pass += 1) {
    await settleDom(page)
    const heading = page.getByRole("heading", { level: 1, name: title })
    const sportBadge = page.getByText("축구", { exact: true })
    assert.equal(await heading.isVisible(), true)
    assert.equal(await sportBadge.isVisible(), true)
    assert.equal((await sportBadge.textContent())?.trim(), "축구")
    assert.ok((await sportBadge.boundingBox())?.width >= 32)
    assert.equal(await media.isVisible(), true)
    assert.equal(await page.locator("[data-lesson-gallery-thumbnail]").count(), thumbnails)
    await page.waitForTimeout(80)
  }
}

export async function readTitleMetrics(page, title) {
  const receipt = await page.getByRole("heading", { level: 1, name: title }).evaluate((element) => {
    const text = element.textContent?.trim() ?? ""
    const textNode = element.firstChild
    const tokens = [...text.matchAll(/\S+/gu)].map((match) => {
      const range = document.createRange()
      range.setStart(textNode, match.index)
      range.setEnd(textNode, match.index + match[0].length)
      return { text: match[0], top: Math.round(range.getBoundingClientRect().top * 10) / 10 }
    })
    const lines = []
    for (const token of tokens) {
      const line = lines.find((candidate) => candidate.top === token.top)
      if (line) line.tokens.push(token.text)
      else lines.push({ top: token.top, tokens: [token.text] })
    }
    return {
      clientWidth: element.clientWidth,
      lastLineTokens: lines.at(-1)?.tokens ?? [],
      lines,
      scrollWidth: element.scrollWidth,
      textWrap: getComputedStyle(element).textWrap,
    }
  })
  assert.equal(receipt.textWrap, "balance", `${title} uses balanced text wrapping`)
  assert.equal(receipt.scrollWidth <= receipt.clientWidth, true, `${title} heading overflow`)
  assert.equal(
    receipt.lastLineTokens.length === 1 && receipt.lastLineTokens[0].length <= 2,
    false,
    `${title} final short token is orphaned`,
  )
  return receipt
}

export async function settleDom(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const images = [...document.images].filter((image) => image.offsetParent !== null)
    await Promise.all(images.map((image) => (image.complete ? undefined : image.decode())))
  })
}

export async function readBadgeDomReceipt(sportBadge) {
  assert.equal(await sportBadge.count(), 1)
  return sportBadge.evaluate(async (element) => {
    await document.fonts.ready
    const textContent = element.textContent?.trim() ?? ""
    const bounds = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const textBounds = range.getBoundingClientRect()
    const computed = getComputedStyle(element)
    const fontSpec = [
      computed.fontStyle,
      computed.fontWeight,
      computed.fontSize,
      computed.fontFamily,
    ]
      .filter(Boolean)
      .join(" ")
    return {
      bounds: { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y },
      computed: {
        backgroundColor: computed.backgroundColor,
        borderColor: computed.borderTopColor,
        color: computed.color,
        display: computed.display,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        opacity: computed.opacity,
        visibility: computed.visibility,
      },
      fontLoaded: document.fonts.check(fontSpec, textContent),
      fontsStatus: document.fonts.status,
      tagName: element.tagName,
      textBounds: {
        height: textBounds.height,
        width: textBounds.width,
        x: textBounds.x - bounds.x,
        y: textBounds.y - bounds.y,
      },
      textContent,
    }
  })
}

export function assertBadgeDomReceipt(receipt) {
  assert.equal(receipt.textContent, "축구")
  assert.equal(receipt.tagName, "SPAN")
  assert.equal(receipt.fontLoaded, true)
  assert.equal(receipt.fontsStatus, "loaded")
  assert.equal(receipt.computed.visibility, "visible")
  assert.notEqual(receipt.computed.display, "none")
  assert.ok(Number(receipt.computed.opacity) > 0)
  assert.ok(receipt.bounds.width >= 32)
  assert.ok(receipt.bounds.height > 0)
  assert.ok(receipt.textBounds.width > 0)
  assert.ok(receipt.textBounds.height > 0)
}

export async function readPageMetrics(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden"
    }
    const gallery = document.querySelector('[aria-label$="레슨 이미지"]')
    const controls = gallery
      ? [...gallery.querySelectorAll("button")].filter(visible).map((element) => {
          const rect = element.getBoundingClientRect()
          return {
            height: rect.height,
            label: element.getAttribute("aria-label") ?? "",
            width: rect.width,
          }
        })
      : []
    const images = gallery
      ? [...gallery.querySelectorAll("img")].filter(visible).map((image) => {
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
      : []
    const textOverflow = [...document.querySelectorAll("h1, h2, p, span")]
      .filter(visible)
      .some((element) => element.scrollWidth > element.clientWidth + 1)
    const activeElement = document.activeElement
    const activeStyle = activeElement ? getComputedStyle(activeElement) : null
    return {
      controls,
      documentScrollWidth: document.documentElement.scrollWidth,
      focus: {
        activeElement: activeElement !== null && activeElement !== document.body,
        ariaLabel: activeElement?.getAttribute("aria-label") ?? "",
        focusVisible: activeElement?.matches(":focus-visible") ?? false,
        outlineStyle: activeStyle?.outlineStyle ?? "none",
        outlineWidth: activeStyle?.outlineWidth ?? "0px",
        tagName: activeElement?.tagName ?? "",
        text: activeElement?.textContent?.trim() ?? "",
      },
      images,
      textOverflow,
      viewport: { height: innerHeight, width: innerWidth },
    }
  })
}

export async function originalUrl(locator) {
  return locator.evaluate((image) => {
    const source = new URL(image.currentSrc || image.src)
    return source.searchParams.get("url") || image.currentSrc || image.src
  })
}
