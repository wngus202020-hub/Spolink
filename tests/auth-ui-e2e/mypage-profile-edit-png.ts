import { inflateSync } from "node:zlib"

export type ProfileEditPngStats = Readonly<{
  height: number
  nonBackgroundPixelCount: number
  uniqueRgbCount: number
  width: number
}>

export function readProfileEditPngStats(buffer: Buffer): ProfileEditPngStats {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Profile edit screenshot is not a PNG.")
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer.readUInt8(24)
  const colorType = buffer.readUInt8(25)
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("Profile edit screenshot uses an unsupported PNG color format.")
  }
  return readInflatedPngStats({ buffer, bytesPerPixel: colorType === 6 ? 4 : 3, height, width })
}

function readInflatedPngStats({
  buffer,
  bytesPerPixel,
  height,
  width,
}: Readonly<{
  buffer: Buffer
  bytesPerPixel: number
  height: number
  width: number
}>): ProfileEditPngStats {
  const inflated = inflateSync(Buffer.concat(readIdatChunks(buffer)))
  const stride = width * bytesPerPixel
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)
  const colors = new Set<string>()
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

function readIdatChunks(buffer: Buffer): Buffer[] {
  const chunks: Buffer[] = []
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    if (type === "IDAT") chunks.push(buffer.subarray(dataStart, dataStart + length))
    offset = dataStart + length + 4
  }
  return chunks
}

function unfilterScanline(
  current: Buffer,
  previous: Buffer,
  filter: number,
  bytesPerPixel: number,
): void {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? (current[index - bytesPerPixel] ?? 0) : 0
    const up = previous[index] ?? 0
    const upLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0
    if (filter === 1) current[index] = ((current[index] ?? 0) + left) & 0xff
    else if (filter === 2) current[index] = ((current[index] ?? 0) + up) & 0xff
    else if (filter === 3)
      current[index] = ((current[index] ?? 0) + Math.floor((left + up) / 2)) & 0xff
    else if (filter === 4) current[index] = ((current[index] ?? 0) + paeth(left, up, upLeft)) & 0xff
    else if (filter !== 0) throw new Error("Profile edit screenshot has an invalid PNG filter.")
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}
