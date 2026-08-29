import { inflateSync } from "node:zlib"

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function decodePngRgba(bytes) {
  if (bytes.length < pngSignature.length || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error("Invalid PNG signature")
  }
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const imageData = []
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) throw new Error("PNG chunk exceeds file bounds")
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? -1
      interlace = data[12] ?? -1
    } else if (type === "IDAT") {
      imageData.push(data)
    } else if (type === "IEND") {
      break
    }
    offset = dataEnd + 4
  }
  if (width < 1 || height < 1 || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Unsupported PNG image format")
  }
  if (interlace !== 0) throw new Error("Interlaced PNG is not supported")
  const channels = colorType === 6 ? 4 : 3
  const rowBytes = width * channels
  const inflated = inflateSync(Buffer.concat(imageData))
  if (inflated.length !== (rowBytes + 1) * height) {
    throw new Error("PNG scanline length mismatch")
  }
  const decoded = Buffer.alloc(rowBytes * height)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (rowBytes + 1)
    const targetOffset = row * rowBytes
    unfilterRow({
      bytesPerPixel: channels,
      decoded,
      filter: inflated[sourceOffset] ?? -1,
      inflated,
      rowBytes,
      sourceOffset: sourceOffset + 1,
      targetOffset,
    })
  }
  return {
    data: colorType === 6 ? decoded : rgbToRgba(decoded),
    height,
    width,
  }
}

export function pixelDifferenceRatio(first, second) {
  if (first.length % 4 !== 0 || second.length % 4 !== 0) {
    throw new Error("Pixel buffers must be RGBA")
  }
  const sharedPixels = Math.min(first.length, second.length) / 4
  const totalPixels = Math.max(first.length, second.length) / 4
  let changed = totalPixels - sharedPixels
  for (let pixel = 0; pixel < sharedPixels; pixel += 1) {
    const offset = pixel * 4
    let maximumDelta = 0
    for (let channel = 0; channel < 4; channel += 1) {
      maximumDelta = Math.max(
        maximumDelta,
        Math.abs((first[offset + channel] ?? 0) - (second[offset + channel] ?? 0)),
      )
    }
    if (maximumDelta > 8) changed += 1
  }
  return totalPixels === 0 ? 0 : changed / totalPixels
}

function unfilterRow(input) {
  for (let column = 0; column < input.rowBytes; column += 1) {
    const raw = input.inflated[input.sourceOffset + column] ?? 0
    const left =
      column >= input.bytesPerPixel
        ? (input.decoded[input.targetOffset + column - input.bytesPerPixel] ?? 0)
        : 0
    const above =
      input.targetOffset >= input.rowBytes
        ? (input.decoded[input.targetOffset + column - input.rowBytes] ?? 0)
        : 0
    const upperLeft =
      input.targetOffset >= input.rowBytes && column >= input.bytesPerPixel
        ? (input.decoded[input.targetOffset + column - input.rowBytes - input.bytesPerPixel] ?? 0)
        : 0
    const reconstructed = reconstruct(input.filter, raw, left, above, upperLeft)
    input.decoded[input.targetOffset + column] = reconstructed
  }
}

function reconstruct(filter, raw, left, above, upperLeft) {
  if (filter === 0) return raw
  if (filter === 1) return (raw + left) & 0xff
  if (filter === 2) return (raw + above) & 0xff
  if (filter === 3) return (raw + Math.floor((left + above) / 2)) & 0xff
  if (filter === 4) return (raw + paeth(left, above, upperLeft)) & 0xff
  throw new Error("Unsupported PNG scanline filter")
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  return aboveDistance <= upperLeftDistance ? above : upperLeft
}

function rgbToRgba(rgb) {
  const rgba = Buffer.alloc((rgb.length / 3) * 4)
  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    rgba[target] = rgb[source] ?? 0
    rgba[target + 1] = rgb[source + 1] ?? 0
    rgba[target + 2] = rgb[source + 2] ?? 0
    rgba[target + 3] = 255
  }
  return rgba
}
