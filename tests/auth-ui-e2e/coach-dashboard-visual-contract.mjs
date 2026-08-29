export function detectGeometryIssues(snapshot) {
  const issues = new Set()
  if (snapshot.documentWidth > snapshot.viewportWidth + 1) issues.add("document-overflow")
  if (snapshot.focusRequired && !snapshot.focused) issues.add("focus-missing")
  if (snapshot.cjkOrphans > 0) issues.add("cjk-orphan")
  if (snapshot.issueIndicators > 0) issues.add("issue-indicator")
  if (snapshot.replacementGlyphs > 0) issues.add("replacement-glyph")

  for (const box of snapshot.boxes) {
    if (
      box.x < -1 ||
      box.x + box.width > snapshot.viewportWidth + 1 ||
      box.scrollWidth > box.clientWidth + 1 ||
      box.scrollHeight > box.clientHeight + 1
    ) {
      issues.add("element-clipping")
    }
  }
  for (let leftIndex = 0; leftIndex < snapshot.boxes.length; leftIndex += 1) {
    const left = snapshot.boxes[leftIndex]
    if (!left) continue
    for (let rightIndex = leftIndex + 1; rightIndex < snapshot.boxes.length; rightIndex += 1) {
      const right = snapshot.boxes[rightIndex]
      if (!right || left.parent !== right.parent) continue
      if (intersectionArea(left, right) > 4) issues.add("sibling-overlap")
    }
  }
  for (const group of snapshot.stableGroups) {
    if (spread(group.heights) > 2 || spread(group.widths) > 2) {
      issues.add("unstable-dimensions")
    }
  }
  return [...issues].sort()
}

export function analyzePixelBuffer({ data, height, width }) {
  if (data.length !== width * height * 4) {
    throw new Error("RGBA pixel buffer dimensions do not match")
  }
  const colors = new Set()
  let luminanceSum = 0
  let luminanceSquaredSum = 0
  let minimumLuminance = 255
  let maximumLuminance = 0
  const pixels = width * height
  const stride = Math.max(1, Math.floor(pixels / 200_000))

  for (let pixel = 0; pixel < pixels; pixel += stride) {
    const offset = pixel * 4
    const red = data[offset] ?? 0
    const green = data[offset + 1] ?? 0
    const blue = data[offset + 2] ?? 0
    const alpha = data[offset + 3] ?? 0
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    colors.add(`${red >> 3}:${green >> 3}:${blue >> 3}:${alpha >> 5}`)
    luminanceSum += luminance
    luminanceSquaredSum += luminance * luminance
    minimumLuminance = Math.min(minimumLuminance, luminance)
    maximumLuminance = Math.max(maximumLuminance, luminance)
  }
  const sampledPixels = Math.ceil(pixels / stride)
  const mean = luminanceSum / sampledPixels
  const variance = Math.max(0, luminanceSquaredSum / sampledPixels - mean * mean)
  const uniqueColors = colors.size
  return {
    blank: uniqueColors < 8 || maximumLuminance - minimumLuminance < 12 || variance < 8,
    luminanceRange: maximumLuminance - minimumLuminance,
    luminanceVariance: variance,
    sampledPixels,
    uniqueColors,
  }
}

export function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function parseRgbColor(value) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(value)
  if (!match) throw new Error("Rendered color must be rgb or rgba")
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function intersectionArea(left, right) {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  return width * height
}

function spread(values) {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

function relativeLuminance([red, green, blue]) {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue)
}

function linearChannel(value) {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}
