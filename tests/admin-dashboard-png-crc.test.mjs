import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { writeAdminDashboardEvidenceFixture } from "./auth-ui-e2e/admin-dashboard-preflight-fixture.mjs"

test("preflight fixture PNGs emit valid IHDR, IDAT, and IEND CRC32 values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-dashboard-png-crc-"))
  try {
    await writeAdminDashboardEvidenceFixture(root)

    const chunksByViewport = await Promise.all(
      ["desktop.png", "tablet.png", "mobile.png"].map(async (name) =>
        readPngCriticalChunks(await readFile(path.join(root, name))),
      ),
    )

    for (const chunks of chunksByViewport) {
      assert.deepEqual(
        chunks.map(({ type }) => type),
        ["IHDR", "IDAT", "IEND"],
      )
      assert.equal(chunks[0].length, 13)
      assert.equal(chunks[2].length, 0)
      assert.equal(
        chunks.every(({ crcValid }) => crcValid),
        true,
      )
    }
    assert.equal(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

function readPngCriticalChunks(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const chunks = []
  for (let offset = 8; offset < png.length; ) {
    assert.ok(offset + 12 <= png.length)
    const length = png.readUInt32BE(offset)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    assert.ok(chunkEnd <= png.length)
    const type = png.toString("ascii", offset + 4, dataStart)
    assert.match(type, /^[A-Za-z]{4}$/u)
    chunks.push({
      crcValid: png.readUInt32BE(dataEnd) === crc32(png.subarray(offset + 4, dataEnd)),
      length,
      type,
    })
    offset = chunkEnd
  }
  assert.equal(chunks.at(-1)?.type, "IEND")
  return chunks
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
