import { inflateSync } from "node:zlib"

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export function readReviewPngStats(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("Review visual is not a valid PNG.")
  }
  const chunks = readChunks(buffer)
  const header = chunks.find((chunk) => chunk.type === "IHDR")
  const end = chunks.find((chunk) => chunk.type === "IEND")
  const imageData = chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)
  if (header?.data.length !== 13 || !end || imageData.length === 0) {
    throw new Error("Review PNG is missing required chunks.")
  }
  const width = header.data.readUInt32BE(0)
  const height = header.data.readUInt32BE(4)
  const bitDepth = header.data.readUInt8(8)
  const colorType = header.data.readUInt8(9)
  if (width <= 0 || height <= 0 || bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error("Review PNG uses an unsupported image format.")
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const inflated = inflateSync(Buffer.concat(imageData))
  const stride = width * bytesPerPixel
  if (inflated.length !== (stride + 1) * height) {
    throw new Error("Review PNG scanline length is invalid.")
  }
  return countPixels({ bytesPerPixel, height, inflated, stride, width })
}

function readChunks(buffer) {
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) throw new Error("Review PNG has a truncated chunk.")
    const length = buffer.readUInt32BE(offset)
    const typeStart = offset + 4
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (chunkEnd > buffer.length) throw new Error("Review PNG chunk exceeds file bounds.")
    const typeBytes = buffer.subarray(typeStart, dataStart)
    const data = buffer.subarray(dataStart, dataEnd)
    const expectedCrc = buffer.readUInt32BE(dataEnd)
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error("Review PNG chunk CRC is invalid.")
    }
    chunks.push({ data, type: typeBytes.toString("ascii") })
    offset = chunkEnd
  }
  if (offset !== buffer.length) throw new Error("Review PNG has trailing bytes.")
  return chunks
}

function countPixels({ bytesPerPixel, height, inflated, stride, width }) {
  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)
  const colors = new Set()
  let background = null
  let nonBackgroundPixelCount = 0
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated.readUInt8(offset)
    offset += 1
    inflated.copy(current, 0, offset, offset + stride)
    offset += stride
    unfilter(current, previous, filter, bytesPerPixel)
    for (let x = 0; x < width; x += 1) {
      const pixel = x * bytesPerPixel
      const color = `${current[pixel]},${current[pixel + 1]},${current[pixel + 2]}`
      if (background === null) background = color
      if (color !== background) nonBackgroundPixelCount += 1
      colors.add(color)
    }
    current.copy(previous)
  }
  return { height, nonBackgroundPixelCount, uniqueRgbCount: colors.size, width }
}

function unfilter(current, previous, filter, bytesPerPixel) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0
    const up = previous[index] ?? 0
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
    if (filter === 1) current[index] = ((current[index] ?? 0) + left) & 0xff
    else if (filter === 2) current[index] = ((current[index] ?? 0) + up) & 0xff
    else if (filter === 3)
      current[index] = ((current[index] ?? 0) + Math.floor((left + up) / 2)) & 0xff
    else if (filter === 4) current[index] = ((current[index] ?? 0) + paeth(left, up, upLeft)) & 0xff
    else if (filter !== 0) throw new Error("Review PNG filter is invalid.")
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

function crc32(value) {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
