import { readFile } from "node:fs/promises"
import { inflateSync } from "node:zlib"

const MINIMUM_GLYPH_PIXELS = 12
const MINIMUM_GLYPH_ROWS = 3
const MINIMUM_GLYPH_COLUMNS = 6
const MAX_TEXT_COLOR_DISTANCE = 72 ** 2
const MINIMUM_COLOR_ADVANTAGE = 18 ** 2

export function analyzeGlyphPixels({
  backgroundColor,
  borderColor,
  data,
  height,
  region,
  textColor,
  width,
}) {
  const rows = new Set()
  const columns = new Set()
  let glyphPixels = 0
  const startX = Math.max(0, Math.floor(region.x))
  const endX = Math.min(width, Math.ceil(region.x + region.width))
  const startY = Math.max(0, Math.floor(region.y))
  const endY = Math.min(height, Math.ceil(region.y + region.height))

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * width + x) * 3
      const pixel = [data[offset], data[offset + 1], data[offset + 2]]
      const textDistance = colorDistance(pixel, textColor)
      const backgroundDistance = colorDistance(pixel, backgroundColor)
      const borderDistance = colorDistance(pixel, borderColor)
      if (
        textDistance <= MAX_TEXT_COLOR_DISTANCE &&
        textDistance + MINIMUM_COLOR_ADVANTAGE < backgroundDistance &&
        textDistance + MINIMUM_COLOR_ADVANTAGE < borderDistance
      ) {
        glyphPixels += 1
        rows.add(y)
        columns.add(x)
      }
    }
  }

  if (
    glyphPixels < MINIMUM_GLYPH_PIXELS ||
    rows.size < MINIMUM_GLYPH_ROWS ||
    columns.size < MINIMUM_GLYPH_COLUMNS
  ) {
    throw new Error(
      `PNG glyph pixels missing: pixels=${glyphPixels}, rows=${rows.size}, columns=${columns.size}`,
    )
  }
  return { glyphColumns: columns.size, glyphPixels, glyphRows: rows.size }
}

export async function validateBadgeRaster({ bounds, colors, fullPath, clipPath, textRegion }) {
  const full = decodePng(await readFile(fullPath))
  const clip = decodePng(await readFile(clipPath))
  const expectedWidth = Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x)
  const expectedHeight = Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y)
  if (clip.width !== expectedWidth || clip.height !== expectedHeight) {
    throw new Error(
      `Unexpected badge clip dimensions ${clip.width}x${clip.height}; expected ${expectedWidth}x${expectedHeight}`,
    )
  }
  const glyph = analyzeGlyphPixels({
    backgroundColor: parseCssRgb(colors.backgroundColor),
    borderColor: parseCssRgb(colors.borderColor),
    data: clip.data,
    height: clip.height,
    region: textRegion,
    textColor: parseCssRgb(colors.color),
    width: clip.width,
  })
  const comparison = compareFullRegionToClip(full, clip, bounds)
  if (comparison.diffRatio > 0.001) {
    throw new Error(`Badge clip differs from full PNG region: ratio=${comparison.diffRatio}`)
  }
  return { ...glyph, ...comparison, clipHeight: clip.height, clipWidth: clip.width }
}

export function parseCssRgb(value) {
  const channels = value
    .match(/\d+(?:\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number)
  if (channels?.length !== 3 || channels.some((channel) => channel < 0 || channel > 255)) {
    throw new Error(`Unsupported computed color: ${value}`)
  }
  return channels
}

function compareFullRegionToClip(full, clip, bounds) {
  let best
  const originsX = coordinateCandidates(bounds.x)
  const originsY = coordinateCandidates(bounds.y)
  for (const originY of originsY) {
    for (const originX of originsX) {
      if (originX < 0 || originY < 0) continue
      if (originX + clip.width > full.width || originY + clip.height > full.height) continue
      let diffPixels = 0
      for (let y = 0; y < clip.height; y += 1) {
        for (let x = 0; x < clip.width; x += 1) {
          const clipOffset = (y * clip.width + x) * 3
          const fullOffset = ((originY + y) * full.width + originX + x) * 3
          if (
            clip.data[clipOffset] !== full.data[fullOffset] ||
            clip.data[clipOffset + 1] !== full.data[fullOffset + 1] ||
            clip.data[clipOffset + 2] !== full.data[fullOffset + 2]
          ) {
            diffPixels += 1
          }
        }
      }
      const candidate = {
        diffPixels,
        diffRatio: diffPixels / (clip.width * clip.height),
        fullOriginX: originX,
        fullOriginY: originY,
      }
      if (!best || candidate.diffPixels < best.diffPixels) best = candidate
    }
  }
  if (!best) throw new Error("Badge clip cannot be aligned inside full PNG")
  return best
}

function coordinateCandidates(value) {
  return [...new Set([Math.floor(value), Math.round(value), Math.ceil(value)])]
}

function colorDistance(left, right) {
  return left.reduce((total, channel, index) => total + (channel - right[index]) ** 2, 0)
}

function decodePng(bytes) {
  let offset = 8
  let header
  const compressed = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      header = {
        bitDepth: data[8],
        colorType: data[9],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0),
      }
    } else if (type === "IDAT") compressed.push(data)
    else if (type === "IEND") break
    offset += length + 12
  }
  if (header?.bitDepth !== 8 || header.colorType !== 2 || header.interlace !== 0) {
    throw new Error("Unsupported Playwright PNG format")
  }
  const bytesPerPixel = 3
  const stride = header.width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(compressed))
  const decoded = Buffer.alloc(stride * header.height)
  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[y * (stride + 1)]
    const sourceOffset = y * (stride + 1) + 1
    const targetOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + x]
      const left = x >= bytesPerPixel ? decoded[targetOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? decoded[targetOffset + x - stride] : 0
      const upperLeft =
        y > 0 && x >= bytesPerPixel ? decoded[targetOffset + x - stride - bytesPerPixel] : 0
      decoded[targetOffset + x] = unfilterByte(filter, raw, left, up, upperLeft)
    }
  }
  return { data: decoded, height: header.height, width: header.width }
}

function unfilterByte(filter, raw, left, up, upperLeft) {
  if (filter === 0) return raw
  if (filter === 1) return (raw + left) & 0xff
  if (filter === 2) return (raw + up) & 0xff
  if (filter === 3) return (raw + Math.floor((left + up) / 2)) & 0xff
  if (filter === 4) return (raw + paeth(left, up, upperLeft)) & 0xff
  throw new Error(`Unsupported PNG filter ${filter}`)
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}
