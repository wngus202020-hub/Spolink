import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { deflateSync } from "node:zlib"

import { buildAdminDashboardSummary, readPngStats } from "./admin-dashboard-evidence.mjs"
import { writeAdminDashboardEvidenceFixture } from "./admin-dashboard-preflight-fixture.mjs"

// allow: SIZE_OK - parser fixtures and adversarial PNG cases share one focused test surface.

const rgbRows = [
  [
    [10, 20, 30],
    [40, 50, 60],
    [70, 80, 90],
  ],
  [
    [10, 20, 30],
    [15, 25, 35],
    [40, 50, 60],
  ],
]

test("dashboard summary binds every current product and harness source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-dashboard-binding-"))
  try {
    await writeAdminDashboardEvidenceFixture(root)
    const summary = await buildAdminDashboardSummary({ workspaceDir: root })
    const bindings = new Map(summary.sourceBindings?.map((item) => [item.path, item.sha256]))
    const requiredPaths = [
      "app/admin/page.tsx",
      "lib/auth/route-security.ts",
      "lib/reservations/reservation-lifecycle-route-adapter.ts",
      "package.json",
      "tests/api-contract-inventory.mjs",
      "tests/api-contract-runner.mjs",
      "tests/run-api-contracts.mjs",
      "tests/admin-dashboard-e2e-preflight.test.mjs",
      "tests/admin-dashboard-png-crc.test.mjs",
      "tests/auth-ui-e2e/admin-dashboard-evidence.mjs",
      "tests/auth-ui-e2e/admin-dashboard-evidence.test.mjs",
      "tests/auth-ui-e2e/admin-dashboard-scenario.ts",
      "tests/auth-ui-e2e/run-task-10-ui.mjs",
      "tests/auth-ui-e2e/task-10-ui.spec.ts",
    ]

    assert.deepEqual(
      [...bindings.keys()].filter((item) => requiredPaths.includes(item)),
      [...requiredPaths].sort(),
    )
    for (const filePath of requiredPaths) {
      const expected = createHash("sha256")
        .update(await readFile(filePath))
        .digest("hex")
      assert.equal(bindings.get(filePath), expected, filePath)
    }
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("dashboard PNG reader decodes standard RGB row filters 0-4", () => {
  for (let filter = 0; filter <= 4; filter += 1) {
    const png = createPng({ colorType: 2, filters: [0, filter], rows: rgbRows })
    assert.deepEqual(readPngStats(png), {
      height: 2,
      nonBackgroundPixelCount: 4,
      uniqueRgbCount: 4,
      width: 3,
    })
  }
})

test("dashboard PNG reader uses RGBA bytes-per-pixel semantics", () => {
  const rows = rgbRows.map((row, y) =>
    row.map(([red, green, blue], x) => [red, green, blue, 40 + y * 20 + x]),
  )
  const png = createPng({ colorType: 6, filters: [0, 4], rows })

  assert.deepEqual(readPngStats(png), {
    height: 2,
    nonBackgroundPixelCount: 4,
    uniqueRgbCount: 4,
    width: 3,
  })
})

test("fixture CRC32 matches the standard check vector", () => {
  assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926)
})

test("fixture emits the fixed standard IEND chunk CRC", () => {
  const png = createPng({ colorType: 2, filters: [0, 0], rows: rgbRows })

  assert.equal(findChunk(png, "IEND").readUInt32BE(8), 0xae426082)
})

for (const chunkType of ["IHDR", "IDAT", "IEND"]) {
  test(`dashboard PNG reader rejects a tampered ${chunkType} CRC`, () => {
    const valid = createPng({ colorType: 2, filters: [0, 0], rows: rgbRows })

    assert.throws(() => readPngStats(tamperChunkCrc(valid, chunkType)), /CRC/u)
  })
}

test("dashboard PNG reader rejects unknown filters and malformed image data", () => {
  const valid = createPng({ colorType: 2, filters: [0, 0], rows: rgbRows })
  const invalidCompressed = createPng({
    colorType: 2,
    compressed: Buffer.from("not-deflate-data"),
    filters: [0, 0],
    rows: rgbRows,
  })
  const shortRows = createPng({
    colorType: 2,
    filters: [0, 0],
    rawOverride: Buffer.alloc(3),
    rows: rgbRows,
  })
  const longRows = createPng({
    colorType: 2,
    filters: [0, 0],
    rawOverride: Buffer.alloc(21),
    rows: rgbRows,
  })

  assert.throws(
    () => readPngStats(createPng({ colorType: 2, filters: [0, 5], rows: rgbRows })),
    /filter/u,
  )
  assert.throws(() => readPngStats(valid.subarray(0, valid.length - 1)), /truncated/u)
  assert.throws(() => readPngStats(invalidCompressed))
  assert.throws(() => readPngStats(shortRows), /row data/u)
  assert.throws(() => readPngStats(longRows))
})

test("dashboard PNG reader rejects missing, duplicate, and out-of-order critical chunks", () => {
  const valid = createPng({ colorType: 2, filters: [0, 0], rows: rgbRows })
  const signature = valid.subarray(0, 8)
  const ihdr = findChunk(valid, "IHDR")
  const idatData = findChunk(valid, "IDAT").subarray(8, -4)
  const iend = findChunk(valid, "IEND")
  const split = Math.floor(idatData.length / 2)

  assert.throws(() => readPngStats(Buffer.concat([signature, ihdr, iend])), /missing/u)
  assert.throws(
    () => readPngStats(Buffer.concat([signature, ihdr, ihdr, pngChunk("IDAT", idatData), iend])),
    /IHDR/u,
  )
  assert.throws(
    () =>
      readPngStats(
        Buffer.concat([
          signature,
          ihdr,
          pngChunk("IDAT", idatData.subarray(0, split)),
          pngChunk("tEXt", Buffer.alloc(0)),
          pngChunk("IDAT", idatData.subarray(split)),
          iend,
        ]),
      ),
    /non-consecutive/u,
  )
  assert.throws(
    () =>
      readPngStats(
        Buffer.concat([
          signature,
          ihdr,
          pngChunk("IDAT", idatData),
          pngChunk("PLTE", Buffer.from([0, 0, 0])),
          iend,
        ]),
      ),
    /PLTE/u,
  )
  assert.throws(
    () => readPngStats(Buffer.concat([signature, ihdr, pngChunk("ABCD", Buffer.alloc(0)), iend])),
    /critical chunk/u,
  )
})

test("dashboard PNG reader rejects unsupported formats and unsafe dimensions", () => {
  assert.throws(
    () => readPngStats(createPng({ bitDepth: 16, colorType: 2, filters: [0, 0], rows: rgbRows })),
    /unsupported PNG format/u,
  )
  assert.throws(
    () => readPngStats(createPng({ colorType: 3, filters: [0, 0], rows: rgbRows })),
    /unsupported PNG format/u,
  )
  assert.throws(
    () =>
      readPngStats(
        createPng({ colorType: 2, filters: [0, 0], height: 0, rows: rgbRows, width: 3 }),
      ),
    /dimensions/u,
  )
  assert.throws(
    () =>
      readPngStats(
        createPng({
          colorType: 2,
          filters: [0],
          height: 0xffffffff,
          rawOverride: Buffer.alloc(1),
          rows: rgbRows,
          width: 0xffffffff,
        }),
      ),
    /dimensions|row size/u,
  )
})

function createPng({
  bitDepth = 8,
  colorType,
  compressed,
  filters,
  rawOverride,
  rows,
  height = rows.length,
  width = rows[0].length,
}) {
  const bytesPerPixel = colorType === 6 ? 4 : 3
  const raw = rawOverride ?? encodeRows(rows, filters, bytesPerPixel)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bitDepth
  ihdr[9] = colorType
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed ?? deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function encodeRows(rows, filters, bytesPerPixel) {
  const stride = rows[0].length * bytesPerPixel
  const raw = Buffer.alloc((stride + 1) * rows.length)
  let previous = Buffer.alloc(stride)
  for (let y = 0; y < rows.length; y += 1) {
    const current = Buffer.from(rows[y].flat())
    const filter = filters[y]
    const rowOffset = y * (stride + 1)
    raw[rowOffset] = filter
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0
      const up = previous[index]
      const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
      raw[rowOffset + index + 1] =
        (current[index] - predictor(filter, left, up, upLeft) + 256) & 0xff
    }
    previous = current
  }
  return raw
}

function predictor(filter, left, up, upLeft) {
  if (filter === 0 || filter === 5) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return Math.floor((left + up) / 2)
  return paeth(left, up, upLeft)
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  return upDistance <= upLeftDistance ? up : upLeft
}

function pngChunk(type, data) {
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  output.write(type, 4, 4, "ascii")
  data.copy(output, 8)
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length)
  return output
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function tamperChunkCrc(png, targetType) {
  const tampered = Buffer.from(png)
  for (let offset = 8; offset < tampered.length; ) {
    const length = tampered.readUInt32BE(offset)
    const type = tampered.toString("ascii", offset + 4, offset + 8)
    const crcOffset = offset + 8 + length
    if (type === targetType) {
      tampered[crcOffset + 3] ^= 0x01
      return tampered
    }
    offset = crcOffset + 4
  }
  throw new Error(`Missing fixture chunk ${targetType}`)
}

function findChunk(png, targetType) {
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    const chunkEnd = offset + 12 + length
    if (png.toString("ascii", offset + 4, offset + 8) === targetType) {
      return png.subarray(offset, chunkEnd)
    }
    offset = chunkEnd
  }
  throw new Error(`Missing fixture chunk ${targetType}`)
}
