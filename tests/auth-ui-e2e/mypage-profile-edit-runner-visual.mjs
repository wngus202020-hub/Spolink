import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { inflateSync } from "node:zlib"

export async function readVisualEvidence(visualDir, { sha256 }) {
  try {
    const entries = (await readdir(visualDir)).sort()
    const pngEntries = entries.filter((entry) => entry.endsWith(".png"))
    const expectedPngs = [
      "profile-edit-legacy-desktop-chromium.png",
      "profile-edit-legacy-mobile-chromium.png",
      "profile-edit-legacy-tablet-chromium.png",
      "profile-edit-success-desktop-chromium.png",
      "profile-edit-success-mobile-chromium.png",
      "profile-edit-success-tablet-chromium.png",
      "profile-edit-validation-mobile-chromium.png",
    ]
    const pngs = await Promise.all(
      expectedPngs.map(async (name) => {
        const buffer = await readFile(path.join(visualDir, name))
        return { name, sha256: sha256(buffer), ...readPngStats(buffer) }
      }),
    )
    const observations = await readObservations(visualDir)
    const scenarioObservations = observations.filter((item) => item.type === "scenario")
    const screenshotObservations = observations.filter((item) => item.type === "screenshot")
    const validationObservations = observations.filter((item) => item.type === "validation")
    const redirectObservations = observations.filter((item) => item.type === "redirects")
    const dimensionsApproved = pngs.every((png) => {
      if (png.name.includes("desktop")) return png.width === 1280 && png.height === 800
      if (png.name.includes("tablet")) return png.width === 768 && png.height === 1024
      return png.width === 390 && png.height === 844
    })
    const pixelsApproved = pngs.every(
      (png) => png.nonBackgroundPixelCount > 1_000 && png.uniqueRgbCount > 16,
    )
    return {
      dimensionsApproved,
      expectedPngCount: expectedPngs.length,
      observedPngCount: pngEntries.length,
      observations: {
        redirects: redirectObservations.length,
        scenario: scenarioObservations.length,
        screenshot: screenshotObservations.length,
        validation: validationObservations.length,
      },
      pixelsApproved,
      pngs,
      verdict:
        pngEntries.length === expectedPngs.length &&
        dimensionsApproved &&
        pixelsApproved &&
        scenarioObservations.length === 3 &&
        screenshotObservations.length === 7 &&
        validationObservations.length === 3 &&
        redirectObservations.length === 3
          ? "APPROVE"
          : "REJECT",
    }
  } catch (error) {
    return {
      errorHash: sha256(error instanceof Error ? error.message : String(error)),
      verdict: "REJECT",
    }
  }
}

async function readObservations(visualDir) {
  const text = await readFile(path.join(visualDir, "observations.jsonl"), "utf8")
  return text
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function readPngStats(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Profile edit screenshot is not a PNG.")
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer.readUInt8(24)
  const colorType = buffer.readUInt8(25)
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("Unsupported profile edit PNG color format.")
  }
  return readInflatedStats(buffer, { bytesPerPixel: colorType === 6 ? 4 : 3, height, width })
}

function readInflatedStats(buffer, { bytesPerPixel, height, width }) {
  const inflated = inflateSync(Buffer.concat(readIdatChunks(buffer)))
  const stride = width * bytesPerPixel
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)
  const colors = new Set()
  let background = ""
  let nonBackgroundPixelCount = 0
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated.readUInt8(offset)
    offset += 1
    inflated.copy(current, 0, offset, offset + stride)
    offset += stride
    unfilterScanline(current, previous, filter, bytesPerPixel)
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * bytesPerPixel
      const color = `${current[pixelOffset] ?? 0},${current[pixelOffset + 1] ?? 0},${current[pixelOffset + 2] ?? 0}`
      if (x === 0 && y === 0) background = color
      if (color !== background) nonBackgroundPixelCount += 1
      colors.add(color)
    }
    current.copy(previous)
  }
  return { height, nonBackgroundPixelCount, uniqueRgbCount: colors.size, width }
}

function readIdatChunks(buffer) {
  const chunks = []
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    if (type === "IDAT") chunks.push(buffer.subarray(dataStart, dataStart + length))
    offset = dataStart + length + 4
  }
  return chunks
}

function unfilterScanline(current, previous, filter, bytesPerPixel) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? (current[index - bytesPerPixel] ?? 0) : 0
    const up = previous[index] ?? 0
    const upLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0
    if (filter === 1) current[index] = ((current[index] ?? 0) + left) & 0xff
    else if (filter === 2) current[index] = ((current[index] ?? 0) + up) & 0xff
    else if (filter === 3)
      current[index] = ((current[index] ?? 0) + Math.floor((left + up) / 2)) & 0xff
    else if (filter === 4) current[index] = ((current[index] ?? 0) + paeth(left, up, upLeft)) & 0xff
    else if (filter !== 0) throw new Error("Invalid profile edit PNG filter.")
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}
