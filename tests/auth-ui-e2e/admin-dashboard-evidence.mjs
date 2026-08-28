import { constants as bufferConstants } from "node:buffer"
import { createHash } from "node:crypto"
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { inflateSync } from "node:zlib"

import { adminDashboardTargetCounts } from "./admin-dashboard-fixture-core.mjs"
import { resolveAdminDashboardSourcePaths } from "./admin-dashboard-source-bindings.mjs"

// allow: SIZE_OK - this bounded evidence reader keeps PNG validation and approval gates together.

export const adminDashboardScreenshotNames = ["desktop.png", "tablet.png", "mobile.png"]
export const adminDashboardSourcePaths = await resolveAdminDashboardSourcePaths()

const projectDimensions = {
  "desktop-chromium": { height: 800, width: 1280 },
  "mobile-chromium": { height: 844, width: 390 },
  "tablet-chromium": { height: 1024, width: 768 },
}
const expectedFilters = [
  "/admin/coaches?status=submitted&page=1&pageSize=20",
  "/admin/lessons",
  "/admin/reports?status=open&page=1&pageSize=20",
  "/admin/reservations?status=disputed&page=1&pageSize=20",
  "/admin/settlements?status=hold",
]
const expectedRedirects = ["anonymous", "profile-required", "learner", "coach", "suspended"]
const expectedStates = ["zero", "loading", "error", "reset"]

export async function buildAdminDashboardSummary({ workspaceDir }) {
  const entries = (await readdir(workspaceDir)).sort()
  const pngNames = entries.filter((entry) => entry.endsWith(".png"))
  const observationNames = entries.filter((entry) => entry.endsWith(".json"))
  const expectedObservations = Object.keys(projectDimensions).flatMap((project) =>
    ["dashboard", "roles", "states"].map((kind) => `${project}-${kind}.json`),
  )
  const inventoryExact =
    JSON.stringify(pngNames) === JSON.stringify([...adminDashboardScreenshotNames].sort()) &&
    JSON.stringify(observationNames) === JSON.stringify(expectedObservations.sort())
  const observations = await Promise.all(
    expectedObservations.map(async (name) =>
      JSON.parse(await readFile(path.join(workspaceDir, name), "utf8")),
    ),
  )
  const screenshots = await Promise.all(
    adminDashboardScreenshotNames.map(async (name) => {
      const buffer = await readFile(path.join(workspaceDir, name))
      const stats = readPngEvidence(buffer)
      return {
        bytes: buffer.byteLength,
        ...stats,
        name,
        sha256: sha256(buffer),
      }
    }),
  )
  const dimensionsExact = screenshots.every((screenshot) => {
    const project = Object.entries(projectDimensions).find(([, dimensions]) =>
      screenshot.name.startsWith(
        dimensions.width === 1280 ? "desktop" : dimensions.width === 768 ? "tablet" : "mobile",
      ),
    )
    return project?.[1].width === screenshot.width && project[1].height === screenshot.height
  })
  const dashboard = observations.filter((item) => item.kind === "dashboard")
  const roles = observations.filter((item) => item.kind === "roles")
  const states = observations.filter((item) => item.kind === "states")
  const cleanupRemaining = observations.reduce(
    (total, item) => total + (Number.isInteger(item.cleanupRemaining) ? item.cleanupRemaining : 1),
    0,
  )
  const redactionFindings = scanSensitive(JSON.stringify({ observations, screenshots }))
  const approved =
    inventoryExact &&
    dimensionsExact &&
    screenshots.every(
      (item) =>
        item.bytes > 1_000 && item.nonBackgroundPixelCount > 1_000 && item.uniqueRgbCount > 16,
    ) &&
    dashboard.length === 3 &&
    dashboard.every(
      (item) =>
        item.metrics?.overflow <= 0 &&
        item.metrics?.overlaps?.length === 0 &&
        item.metrics?.cjkVisibleTextCount > 20 &&
        item.keyboard === true &&
        isDeepStrictEqual(item.counts, adminDashboardTargetCounts) &&
        isDeepStrictEqual(item.filters, expectedFilters) &&
        screenshots.some(
          (screenshot) =>
            screenshot.name === item.screenshot?.name &&
            screenshot.sha256 === item.screenshot?.sha256 &&
            screenshot.bytes === item.screenshot?.bytes,
        ),
    ) &&
    roles.length === 3 &&
    roles.every((item) => isDeepStrictEqual(item.redirects, expectedRedirects)) &&
    states.length === 3 &&
    states.every((item) => isDeepStrictEqual(item.states, expectedStates)) &&
    cleanupRemaining === 0 &&
    redactionFindings === 0
  return {
    cleanup: { remaining: cleanupRemaining },
    coverage: {
      counts: adminDashboardTargetCounts,
      destinations: expectedFilters,
      filters: dashboard.every((item) => isDeepStrictEqual(item.filters, expectedFilters)),
      keyboard: dashboard.every((item) => item.keyboard === true),
      overlapCount: dashboard.reduce((total, item) => total + item.metrics.overlaps.length, 0),
      overflowMax: Math.max(...dashboard.map((item) => item.metrics.overflow)),
      roles: expectedRedirects,
      states: expectedStates,
      zero: states.every((item) => item.states.includes("zero")),
    },
    dimensionsExact,
    inventoryExact,
    observations: { dashboard: dashboard.length, roles: roles.length, states: states.length },
    redactionFindings,
    screenshots,
    sourceBindings: await Promise.all(
      adminDashboardSourcePaths.map(async (filePath) => ({
        path: filePath,
        sha256: sha256(await readFile(filePath)),
      })),
    ),
    verdict: approved ? "APPROVE" : "REJECT",
  }
}

export async function publishAdminDashboardEvidence({ destinationDir, summary, workspaceDir }) {
  if (summary.verdict !== "APPROVE") return false
  await mkdir(destinationDir, { mode: 0o700, recursive: true })
  const existingPngs = (await readdir(destinationDir)).filter((entry) => entry.endsWith(".png"))
  if (existingPngs.some((entry) => !adminDashboardScreenshotNames.includes(entry))) {
    throw new Error("Dashboard evidence destination contains an unowned PNG")
  }
  await Promise.all(
    adminDashboardScreenshotNames.map((name) =>
      copyFile(path.join(workspaceDir, name), path.join(destinationDir, name)),
    ),
  )
  return true
}

function scanSensitive(text) {
  const patterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
    /(?:service[_-]?role|access[_-]?token|refresh[_-]?token|authorization|cookie)/iu,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  ]
  return patterns.filter((pattern) => pattern.test(text)).length
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export function readPngStats(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error("Dashboard screenshot is not a PNG")
  }
  const { idatChunks, ihdr } = readPngChunks(buffer)
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const colorType = ihdr.readUInt8(9)
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (
    ihdr.readUInt8(8) !== 8 ||
    bytesPerPixel === 0 ||
    ihdr.readUInt8(10) !== 0 ||
    ihdr.readUInt8(11) !== 0 ||
    ihdr.readUInt8(12) !== 0
  ) {
    throw new Error("Dashboard screenshot uses an unsupported PNG format")
  }
  if (width === 0 || height === 0) {
    throw new Error("Dashboard PNG dimensions are invalid")
  }
  const stride = width * bytesPerPixel
  const inflatedSize = (stride + 1) * height
  if (
    !Number.isSafeInteger(stride) ||
    !Number.isSafeInteger(inflatedSize) ||
    inflatedSize > bufferConstants.MAX_LENGTH
  ) {
    throw new Error("Dashboard PNG dimensions produce an unsafe row size")
  }
  const inflated = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: inflatedSize })
  if (inflated.length !== inflatedSize) {
    throw new Error("Dashboard PNG row data size is inconsistent")
  }
  const colors = new Set()
  let previous = Buffer.alloc(stride)
  let background = ""
  let nonBackgroundPixelCount = 0
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    const filter = inflated[rowStart]
    const row = Buffer.from(inflated.subarray(rowStart + 1, rowStart + 1 + stride))
    unfilterPngRow(row, previous, filter, bytesPerPixel)
    for (let x = 0; x < width; x += 1) {
      const offset = x * bytesPerPixel
      const color = `${row[offset]},${row[offset + 1]},${row[offset + 2]}`
      if (x === 0 && y === 0) background = color
      if (color !== background) nonBackgroundPixelCount += 1
      colors.add(color)
    }
    previous = row
  }
  return { height, nonBackgroundPixelCount, uniqueRgbCount: colors.size, width }
}

export function readPngEvidence(buffer) {
  const stats = readPngStats(buffer)
  const { criticalChunks, idatChunks, ihdr } = readPngChunks(buffer)
  const bytesPerPixel = ihdr.readUInt8(9) === 6 ? 4 : 3
  const stride = stats.width * bytesPerPixel
  const inflated = inflateSync(Buffer.concat(idatChunks), {
    maxOutputLength: (stride + 1) * stats.height,
  })
  const filters = new Set()
  for (let row = 0; row < stats.height; row += 1) filters.add(inflated[row * (stride + 1)])
  return { ...stats, criticalChunks, crcValid: true, filters: [...filters].sort() }
}

function readPngChunks(buffer) {
  let ihdr = null
  const idatChunks = []
  const criticalChunks = []
  let idatEnded = false
  let sawPlte = false
  let sawIend = false
  for (let offset = 8; offset < buffer.length; ) {
    if (offset + 12 > buffer.length) throw new Error("Dashboard PNG has a truncated chunk")
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const chunkEnd = dataEnd + 4
    if (chunkEnd > buffer.length) throw new Error("Dashboard PNG has a truncated chunk")
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Error("Dashboard PNG has an invalid chunk type")
    if (buffer.readUInt32BE(dataEnd) !== crc32(buffer.subarray(offset + 4, dataEnd))) {
      throw new Error(`Dashboard PNG ${type} chunk CRC is invalid`)
    }
    if ((buffer[offset + 4] & 0x20) === 0) criticalChunks.push(type)
    if (offset === 8 && (type !== "IHDR" || length !== 13)) {
      throw new Error("Dashboard PNG has an invalid IHDR chunk")
    }
    if (type === "IHDR") {
      if (ihdr !== null || length !== 13) throw new Error("Dashboard PNG has an invalid IHDR chunk")
      ihdr = buffer.subarray(dataStart, dataEnd)
    } else if (type === "PLTE") {
      if (sawPlte || idatChunks.length > 0 || length === 0 || length > 768 || length % 3 !== 0) {
        throw new Error("Dashboard PNG has an invalid PLTE chunk")
      }
      sawPlte = true
    } else if (type === "IDAT") {
      if (idatEnded) throw new Error("Dashboard PNG has non-consecutive IDAT chunks")
      idatChunks.push(buffer.subarray(dataStart, dataEnd))
    } else if (type === "IEND") {
      if (length !== 0 || chunkEnd !== buffer.length) {
        throw new Error("Dashboard PNG has invalid trailing data")
      }
      sawIend = true
    } else {
      if ((buffer[offset + 4] & 0x20) === 0) {
        throw new Error(`Dashboard PNG has unsupported critical chunk ${type}`)
      }
      if (idatChunks.length > 0) idatEnded = true
    }
    offset = chunkEnd
  }
  if (ihdr === null || idatChunks.length === 0 || !sawIend) {
    throw new Error("Dashboard PNG is truncated or missing required chunks")
  }
  return { criticalChunks, idatChunks, ihdr }
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

function unfilterPngRow(row, previous, filter, bytesPerPixel) {
  if (filter > 4) throw new Error("Dashboard PNG filter is unsupported")
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0
    const up = previous[index]
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0
    if (filter === 1) row[index] = (row[index] + left) & 0xff
    else if (filter === 2) row[index] = (row[index] + up) & 0xff
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + up) / 2)) & 0xff
    else if (filter === 4) row[index] = (row[index] + paeth(left, up, upLeft)) & 0xff
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
