import assert from "node:assert/strict"
import test from "node:test"
import { deflateSync } from "node:zlib"

import { decodePngRgba, pixelDifferenceRatio } from "./coach-dashboard-png.mjs"

test("PNG decoder restores dimensions and RGBA pixels", () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
  const decoded = decodePngRgba(encodeRgbaPng(2, 2, pixels))

  assert.equal(decoded.width, 2)
  assert.equal(decoded.height, 2)
  assert.deepEqual(decoded.data, pixels)
})

test("PNG decoder rejects an invalid signature", () => {
  assert.throws(() => decodePngRgba(Buffer.from("not-png")), /signature/u)
})

test("pixel difference reports identical and changed frames", () => {
  const first = Buffer.alloc(4 * 4 * 4, 255)
  const second = Buffer.from(first)
  second.fill(0, 0, 16)

  assert.equal(pixelDifferenceRatio(first, first), 0)
  assert.ok(pixelDifferenceRatio(first, second) > 0)
})

function encodeRgbaPng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 4 + 1)
    scanlines[target] = 0
    pixels.copy(scanlines, target + 1, row * width * 4, (row + 1) * width * 4)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
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
