import assert from "node:assert/strict"
import test from "node:test"
import { analyzeGlyphPixels } from "./public-gallery-badge-raster.mjs"

const WIDTH = 24
const HEIGHT = 16
const BACKGROUND = [250, 250, 250]
const BORDER = [110, 110, 110]
const TEXT = [60, 60, 60]
const TEXT_REGION = { height: 8, width: 14, x: 5, y: 4 }

test("rejects a border-only badge when no glyph pixels exist inside the DOM text range", () => {
  const pixels = solidImage(WIDTH, HEIGHT, BACKGROUND)
  drawBorder(pixels, WIDTH, HEIGHT, BORDER)

  assert.throws(
    () =>
      analyzeGlyphPixels({
        backgroundColor: BACKGROUND,
        borderColor: BORDER,
        data: pixels,
        height: HEIGHT,
        region: TEXT_REGION,
        textColor: TEXT,
        width: WIDTH,
      }),
    /glyph pixels missing/,
  )
})

test("accepts text-colored pixels distributed across the DOM text range", () => {
  const pixels = solidImage(WIDTH, HEIGHT, BACKGROUND)
  drawBorder(pixels, WIDTH, HEIGHT, BORDER)
  for (const [x, y] of [
    [7, 5],
    [8, 5],
    [9, 5],
    [13, 5],
    [14, 5],
    [15, 5],
    [7, 6],
    [9, 6],
    [13, 6],
    [15, 6],
    [7, 7],
    [8, 7],
    [9, 7],
    [13, 7],
    [14, 7],
    [15, 7],
  ]) {
    setPixel(pixels, WIDTH, x, y, TEXT)
  }

  assert.deepEqual(
    analyzeGlyphPixels({
      backgroundColor: BACKGROUND,
      borderColor: BORDER,
      data: pixels,
      height: HEIGHT,
      region: TEXT_REGION,
      textColor: TEXT,
      width: WIDTH,
    }),
    { glyphColumns: 6, glyphPixels: 16, glyphRows: 3 },
  )
})

function solidImage(width, height, color) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels.set(color, offset)
  }
  return pixels
}

function drawBorder(pixels, width, height, color) {
  for (let x = 0; x < width; x += 1) {
    setPixel(pixels, width, x, 0, color)
    setPixel(pixels, width, x, height - 1, color)
  }
  for (let y = 0; y < height; y += 1) {
    setPixel(pixels, width, 0, y, color)
    setPixel(pixels, width, width - 1, y, color)
  }
}

function setPixel(pixels, width, x, y, color) {
  pixels.set(color, (y * width + x) * 3)
}
