import { chmod, lstat, mkdir, readdir, readFile, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { decodePngRgba, pixelDifferenceRatio } from "./coach-dashboard-png.mjs"
import { analyzePixelBuffer } from "./coach-dashboard-visual-contract.mjs"
import { sha256 } from "./process.mjs"

const projectDimensions = {
  desktop: { height: 800, width: 1280 },
  mobile: { height: 844, width: 390 },
  tablet: { height: 1024, width: 768 },
}
const lightStates = ["populated", "empty", "loading", "error"]
const sourcePaths = [
  "app/coach/dashboard/error.tsx",
  "app/coach/dashboard/coach-dashboard-recovery-view.tsx",
  "app/coach/dashboard/loading.tsx",
  "app/coach/dashboard/page.tsx",
  "app/globals.css",
  "components/coach/coach-dashboard-activity.tsx",
  "components/coach/coach-dashboard-overview.tsx",
  "components/coach/coach-dashboard-schedule.tsx",
  "tests/auth-ui-e2e/coach-dashboard-live-fixture.ts",
  "tests/auth-ui-e2e/coach-dashboard-fixture-catalog.ts",
  "tests/auth-ui-e2e/coach-dashboard-fixture-plan.ts",
  "tests/auth-ui-e2e/coach-dashboard-fixtures.ts",
  "tests/auth-ui-e2e/coach-dashboard-visual-artifacts.mjs",
  "tests/auth-ui-e2e/coach-dashboard-visual-browser.ts",
  "tests/auth-ui-e2e/coach-dashboard-visual-scenario.ts",
  "tests/auth-ui-e2e/coach-dashboard.spec.ts",
]

export const visualScreenshotNames = [
  ...Object.keys(projectDimensions).flatMap((project) =>
    lightStates.map((state) => screenshotName(state, project, "light")),
  ),
  screenshotName("populated", "desktop", "dark"),
  screenshotName("populated", "mobile", "dark"),
].sort()

export function isCoachDashboardVisualGrep(grep) {
  return typeof grep === "string" && (grep.includes("visual") || grep.includes("responsive"))
}

export async function prepareCoachDashboardVisualDirectory(directory) {
  await mkdir(directory, { mode: 0o700, recursive: true })
  await chmod(directory, 0o700)
  for (const name of await readdir(directory)) {
    const filePath = path.join(directory, name)
    const entry = await lstat(filePath)
    if (!entry.isFile() || !name.endsWith(".png")) {
      throw new Error("Visual output directory contains an unexpected entry")
    }
    await unlink(filePath)
  }
}

export async function readCoachDashboardVisualSourceBinding() {
  const files = await Promise.all(
    sourcePaths.map(async (name) => {
      const [bytes, metadata] = await Promise.all([readFile(name), stat(name)])
      return { mtimeMs: metadata.mtimeMs, name, sha256: sha256(bytes) }
    }),
  )
  const latestMtimeMs = Math.max(...files.map((file) => file.mtimeMs))
  const boundedFiles = files.map(({ name, sha256: fileHash }) => ({ name, sha256: fileHash }))
  return {
    aggregateSha256: sha256(JSON.stringify(boundedFiles)),
    files: boundedFiles,
    latestMtimeMs,
  }
}

export async function collectCoachDashboardVisualEvidence(
  directory,
  { freshnessFloorMs, expectedNames = visualScreenshotNames } = {},
) {
  const issues = []
  const actualNames = (await readdir(directory)).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())) {
    issues.push("screenshot-enumeration")
  }
  const decoded = new Map()
  const files = []
  for (const name of expectedNames) {
    const filePath = path.join(directory, name)
    const entry = await optionalStat(filePath)
    if (!entry?.isFile()) {
      issues.push("screenshot-missing")
      continue
    }
    await chmod(filePath, 0o600)
    const bytes = await readFile(filePath)
    let image
    try {
      image = decodePngRgba(bytes)
    } catch {
      issues.push("png-invalid")
      continue
    }
    const expected = dimensionsForName(name)
    const pixels = analyzePixelBuffer(image)
    const mode = (await stat(filePath)).mode & 0o777
    const fresh = freshnessFloorMs === undefined || entry.mtimeMs >= freshnessFloorMs
    if (image.width !== expected.width) issues.push("viewport-width")
    if (image.height < expected.height) issues.push("composited-height")
    if (pixels.blank) issues.push("blank-image")
    if (!fresh) issues.push("stale-image")
    if (mode !== 0o600) issues.push("image-mode")
    decoded.set(name, image)
    files.push({
      bytes: entry.size,
      fresh,
      height: image.height,
      luminanceVariance: round(pixels.luminanceVariance),
      mode: "0600",
      name,
      sha256: sha256(bytes),
      uniqueColors: pixels.uniqueColors,
      width: image.width,
    })
  }
  const comparisons = []
  for (const project of Object.keys(projectDimensions)) {
    const populated = decoded.get(screenshotName("populated", project, "light"))
    const loading = decoded.get(screenshotName("loading", project, "light"))
    if (!populated || !loading) continue
    const differenceRatio = pixelDifferenceRatio(populated.data, loading.data)
    if (differenceRatio < 0.02) issues.push("loading-populated-similar")
    comparisons.push({
      differenceRatio: round(differenceRatio),
      project,
      verdict: differenceRatio >= 0.02 ? "APPROVE" : "REJECT",
    })
  }
  return {
    comparisons,
    files,
    issues: [...new Set(issues)].sort(),
    verdict: issues.length === 0 ? "APPROVE" : "REJECT",
  }
}

function screenshotName(state, project, scheme) {
  return `coach-dashboard-${state}-${project}-${scheme}.png`
}

function dimensionsForName(name) {
  for (const [project, dimensions] of Object.entries(projectDimensions)) {
    if (name.includes(`-${project}-`)) return dimensions
  }
  throw new Error("Screenshot name does not identify a supported project")
}

async function optionalStat(filePath) {
  try {
    return await stat(filePath)
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000
}
