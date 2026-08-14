import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { sha256 } from "./process.mjs"

export const projects = ["mobile-chromium", "tablet-chromium", "desktop-chromium"]

const matrixStateIds = [
  "home-dark-reduced",
  "home-light-links",
  "media-detail-load-error",
  "media-detail-photo",
  "media-home-mixed",
  "search-history-restored",
  "search-kst-empty",
  "search-kst-known-hit",
  "search-region-drilldown",
]

export async function collectObservations(root) {
  const files = await walk(root)
  const rows = []
  for (const file of files.filter((item) => path.basename(item) === "direction-observation.json")) {
    const row = JSON.parse(await readFile(file, "utf8"))
    if (!Array.isArray(row.states) || row.states.length === 0) {
      throw new Error("Observation must contain named matrix states")
    }
    for (const state of row.states) {
      const screenshotPath = state.screenshotPath
      if (typeof screenshotPath !== "string" || !screenshotPath.startsWith(`${root}${path.sep}`)) {
        throw new Error("Observation screenshot escaped raw output")
      }
      const actualHash = sha256(await readFile(screenshotPath))
      if (actualHash !== state.screenshotSha256) {
        throw new Error("Observation screenshot hash mismatch")
      }
      const { screenshotPath: omitted, ...observation } = state
      void omitted
      rows.push({
        ...observation,
        stateIdentity: stateIdentity(observation),
        stateFingerprint: stateFingerprint(observation),
      })
    }
  }
  return rows.sort((left, right) => left.stateIdentity.localeCompare(right.stateIdentity))
}

export async function collectArtifacts(root) {
  const files = await walk(root)
  const rows = []
  for (const file of files.filter((item) => /\.(png|zip)$/u.test(item))) {
    rows.push({
      kind: file.endsWith(".png") ? "screenshot" : "trace",
      name: path.basename(file),
      sha256: sha256(await readFile(file)),
    })
  }
  return rows.sort((left, right) => left.sha256.localeCompare(right.sha256))
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

export function collectTests(report) {
  const rows = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const testCase of spec.tests ?? []) {
        rows.push({
          project: testCase.projectName,
          status: testCase.results?.[0]?.status ?? "missing",
          title: spec.title,
        })
      }
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites ?? []) visit(suite)
  return rows
}

export function collectTestsSafely(stdout) {
  try {
    return collectTests(JSON.parse(stdout))
  } catch {
    return []
  }
}

export function observationApproved(row) {
  return (
    row.consoleErrorCount === 0 &&
    row.failedAppRequestCount === 0 &&
    row.focusEscapeCount === 0 &&
    row.horizontalOverflow <= 0 &&
    row.pageErrorCount === 0 &&
    /^[a-f0-9]{64}$/u.test(row.screenshotSha256)
  )
}

export async function buildMatrix(repoRoot, observations, artifacts) {
  const expectedIdentities = projects
    .flatMap((project) => matrixStateIds.map((stateId) => `${project}:${stateId}`))
    .sort()
  const actualIdentities = observations.map((row) => `${row.project}:${row.stateId}`).sort()
  const screenshotArtifacts = artifacts.filter((artifact) => artifact.kind === "screenshot")
  const stateHashes = observations.map((row) => row.screenshotSha256).sort()
  const artifactHashes = screenshotArtifacts.map((artifact) => artifact.sha256).sort()
  const pixelProofApproved = observations
    .filter((row) =>
      ["home-dark-reduced", "home-light-links", "media-detail-photo", "media-home-mixed"].includes(
        row.stateId,
      ),
    )
    .every(
      (row) =>
        Array.isArray(row.pixelStatistics) &&
        row.pixelStatistics.length > 0 &&
        row.pixelStatistics.every(pixelProbeApproved),
    )
  const coverageApproved =
    observations.length === expectedIdentities.length &&
    JSON.stringify(actualIdentities) === JSON.stringify(expectedIdentities) &&
    new Set(actualIdentities).size === expectedIdentities.length &&
    screenshotArtifacts.length === expectedIdentities.length &&
    JSON.stringify(stateHashes) === JSON.stringify(artifactHashes) &&
    pixelProofApproved
  let reviewResult
  try {
    reviewResult = await readManualReviews(repoRoot, observations)
  } catch (error) {
    reviewResult = {
      approved: false,
      metadata: {
        independentlyAuthored: false,
        rejectionReason: redact(repoRoot, error instanceof Error ? error.message : String(error)),
        reviewCount: 0,
      },
      states: observations,
    }
  }
  return {
    approved: coverageApproved && reviewResult.approved,
    automatedCoverage: {
      approved: coverageApproved,
      expectedStateCount: expectedIdentities.length,
      matrixStateCount: observations.length,
      pixelProofApproved,
      screenshotArtifactCount: screenshotArtifacts.length,
      uniqueScreenshotHashCount: new Set(stateHashes).size,
    },
    manualReview: reviewResult.metadata,
    states: reviewResult.states,
  }
}

export function emptyMatrix() {
  return {
    approved: false,
    automatedCoverage: {
      approved: false,
      expectedStateCount: projects.length * matrixStateIds.length,
      matrixStateCount: 0,
      pixelProofApproved: false,
      screenshotArtifactCount: 0,
    },
    manualReview: null,
    states: [],
  }
}

async function readManualReviews(repoRoot, observations) {
  const reviewPath = path.resolve(
    repoRoot,
    process.env["SPOLINK_DIRECTION_MANUAL_REVIEW_PATH"] ??
      ".omo/evidence/opencode-direction-alignment/task-14-debug-remediation.md",
  )
  const source = await readFile(reviewPath, "utf8")
  const match = source.match(
    /<!-- task14-manual-review:start -->\s*([\s\S]*?)\s*<!-- task14-manual-review:end -->/u,
  )
  if (!match?.[1]) throw new Error("Manual review mapping is missing")
  const mapping = JSON.parse(match[1])
  if (mapping.schemaVersion !== 1 || !Array.isArray(mapping.reviews)) {
    throw new Error("Manual review mapping is malformed")
  }
  const reviews = new Map(mapping.reviews.map((review) => [review.stateIdentity, review]))
  if (reviews.size !== observations.length || mapping.reviews.length !== observations.length) {
    throw new Error("Manual review mapping count is stale")
  }
  const states = observations.map((state) => {
    const review = reviews.get(state.stateIdentity)
    if (
      !review ||
      review.stateFingerprint !== state.stateFingerprint ||
      review.screenshotSha256 !== state.screenshotSha256 ||
      review.verdict !== "PASS" ||
      typeof review.reviewedAt !== "string" ||
      typeof review.reviewer !== "string" ||
      typeof review.notes !== "string"
    ) {
      throw new Error(`Manual review is missing or stale for ${state.stateIdentity}`)
    }
    return {
      ...state,
      manualReview: {
        notes: review.notes,
        reviewedAt: review.reviewedAt,
        reviewer: review.reviewer,
        verdict: review.verdict,
      },
    }
  })
  return {
    approved: true,
    metadata: {
      independentlyAuthored: true,
      reviewCount: states.length,
      sourcePath: path.relative(repoRoot, reviewPath),
      sourceSha256: sha256(source),
    },
    states,
  }
}

function stateIdentity(state) {
  return `${state.project}:${state.stateId}:${state.viewport.width}x${state.viewport.height}`
}

function stateFingerprint(state) {
  return sha256(
    JSON.stringify({
      project: state.project,
      route: state.route,
      stateId: state.stateId,
      viewport: state.viewport,
    }),
  )
}

function pixelProbeApproved(probe) {
  return (
    probe.canvasMethod === "drawImage/getImageData" &&
    probe.nonSvgSource === true &&
    probe.nonTransparentPixelCount > 0 &&
    probe.uniqueRgbCount > 16 &&
    probe.variance > 1
  )
}

export function sum(rows, key) {
  return rows.reduce((total, row) => total + (typeof row[key] === "number" ? row[key] : 0), 0)
}

function redact(repoRoot, value) {
  return value
    .replaceAll(repoRoot, "<repo>")
    .replace(/\b[A-Za-z0-9._%+-]+@spolink\.test\b/giu, "<redacted-email>")
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "<redacted-jwt>")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/giu, "<redacted-postgres-url>")
}
