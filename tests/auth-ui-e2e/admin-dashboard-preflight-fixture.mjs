import { createHash } from "node:crypto"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { deflateSync } from "node:zlib"

import { adminDashboardTargetCounts } from "./admin-dashboard-fixture-core.mjs"

export async function writeAdminDashboardEvidenceFixture(root) {
  const viewports = [
    ["desktop.png", 1280, 800, "desktop-chromium"],
    ["tablet.png", 768, 1024, "tablet-chromium"],
    ["mobile.png", 390, 844, "mobile-chromium"],
  ]
  for (const [name, width, height, project] of viewports) {
    const png = fakePng(width, height)
    await writeFile(path.join(root, name), png, { mode: 0o600 })
    await writeAdminDashboardObservationFixture(root, project, "dashboard", {
      cleanupRemaining: 0,
      counts: adminDashboardTargetCounts,
      filters: [
        "/admin/coaches?status=submitted&page=1&pageSize=20",
        "/admin/lessons",
        "/admin/reports?status=open&page=1&pageSize=20",
        "/admin/reservations?status=disputed&page=1&pageSize=20",
        "/admin/settlements?status=hold",
      ],
      keyboard: true,
      metrics: { cjkVisibleTextCount: 40, overflow: 0, overlaps: [] },
      screenshot: {
        bytes: png.byteLength,
        name,
        sha256: createHash("sha256").update(png).digest("hex"),
      },
    })
    await writeAdminDashboardObservationFixture(root, project, "roles", {
      cleanupRemaining: 0,
      redirects: ["anonymous", "profile-required", "learner", "coach", "suspended"],
    })
    await writeAdminDashboardObservationFixture(root, project, "states", {
      cleanupRemaining: 0,
      states: ["zero", "loading", "error", "reset"],
    })
  }
}

export function writeAdminDashboardObservationFixture(root, project, kind, value) {
  return writeFile(
    path.join(root, `${project}-${kind}.json`),
    `${JSON.stringify({ kind, project, ...value })}\n`,
    { mode: 0o600 },
  )
}

function fakePng(width, height) {
  const stride = 1 + width * 3
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3
      raw[offset] = (x + y) % 256
      raw[offset + 1] = (x * 3) % 256
      raw[offset + 2] = (y * 5) % 256
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
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
