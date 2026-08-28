import { deflateSync } from "node:zlib"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const JPEG_1X1_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q=="

const WEBP_1X1_BASE64 = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQkUZ0pv+BiOh/AAA="

export const FIVE_MIB = 5 * 1024 * 1024

export function createTinyJpeg() {
  return Buffer.from(JPEG_1X1_BASE64, "base64")
}

export function createTinyPng() {
  return createExactPng(96)
}

export function createTinyWebp() {
  return Buffer.from(WEBP_1X1_BASE64, "base64")
}

export function createExactPng(targetBytes) {
  if (!Number.isInteger(targetBytes) || targetBytes < 81) {
    throw new TypeError("PNG target size must be an integer of at least 81 bytes")
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const idat = deflateSync(Buffer.from([0, 0, 0, 0, 0]), { level: 9 })
  const fixed = Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
  const fillerLength = targetBytes - fixed.length - 12
  if (fillerLength < 2) {
    throw new TypeError("PNG target size cannot hold a valid ancillary chunk")
  }
  const filler = Buffer.alloc(fillerLength, 0x61)
  filler[0] = 0x74
  filler[1] = 0

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("tEXt", filler),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
