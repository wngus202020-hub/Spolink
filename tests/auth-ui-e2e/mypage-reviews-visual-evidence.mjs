import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { readReviewPngStats } from "./mypage-reviews-png.mjs"

export const expectedVisualImages = [
  {
    height: 844,
    name: "reviews-populated-light-390.png",
    state: "populated",
    theme: "light",
    width: 390,
  },
  {
    height: 1024,
    name: "reviews-populated-light-768.png",
    state: "populated",
    theme: "light",
    width: 768,
  },
  {
    height: 800,
    name: "reviews-populated-light-1280.png",
    state: "populated",
    theme: "light",
    width: 1280,
  },
  {
    height: 844,
    name: "reviews-populated-dark-390.png",
    state: "populated",
    theme: "dark",
    width: 390,
  },
  {
    height: 1024,
    name: "reviews-populated-dark-768.png",
    state: "populated",
    theme: "dark",
    width: 768,
  },
  {
    height: 800,
    name: "reviews-populated-dark-1280.png",
    state: "populated",
    theme: "dark",
    width: 1280,
  },
  { height: 844, name: "reviews-empty-390.png", state: "empty", theme: "light", width: 390 },
  {
    height: 800,
    name: "reviews-read-failure-1280.png",
    state: "read-failure",
    theme: "light",
    width: 1280,
  },
  { height: 844, name: "reviews-loading-390.png", state: "loading", theme: "light", width: 390 },
]

export async function validateAndPublishVisualBundle(input) {
  await removePublishedVisuals(input.publishDir)
  try {
    const result = await validateVisualBundle(input)
    await mkdir(input.publishDir, { mode: 0o700, recursive: true })
    for (const image of result.images) {
      const target = path.join(input.publishDir, image.name)
      await copyFile(path.join(input.stagingDir, image.name), target)
      await chmod(target, 0o600)
      if (((await stat(target)).mode & 0o777) !== 0o600) {
        throw new Error(`Published review PNG mode is invalid: ${image.name}`)
      }
    }
    return result
  } catch (error) {
    await removePublishedVisuals(input.publishDir)
    throw error
  }
}

export async function removePublishedVisuals(publishDir) {
  await rm(publishDir, { force: true, recursive: true })
}

async function validateVisualBundle(input) {
  assertParentSha(input.parentSha)
  assertSourceManifest(input.sourceManifest)
  const entries = (await readdir(input.stagingDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => entry.name)
    .sort()
  const expectedNames = expectedVisualImages.map((image) => image.name).sort()
  if (JSON.stringify(entries) !== JSON.stringify(expectedNames)) {
    throw new Error("Review visual staging inventory must contain exactly nine named PNGs.")
  }
  if (!Array.isArray(input.observations) || input.observations.length !== 9) {
    throw new Error("Review visual observations must contain exactly nine entries.")
  }
  const observationByName = new Map()
  for (const observation of input.observations) {
    assertObservation(observation)
    if (observationByName.has(observation.name)) throw new Error("Duplicate visual observation.")
    observationByName.set(observation.name, observation)
  }
  const hashes = new Set()
  const images = []
  for (const expected of expectedVisualImages) {
    const observation = observationByName.get(expected.name)
    if (
      !observation ||
      observation.width !== expected.width ||
      observation.height !== expected.height ||
      observation.state !== expected.state ||
      observation.theme !== expected.theme
    ) {
      throw new Error(`Review visual observation mismatch: ${expected.name}`)
    }
    const filePath = path.join(input.stagingDir, expected.name)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || (fileStat.mode & 0o777) !== 0o600) {
      throw new Error(`Staged review PNG mode is invalid: ${expected.name}`)
    }
    const bytes = await import("node:fs/promises").then(({ readFile }) => readFile(filePath))
    const png = readReviewPngStats(bytes)
    if (png.width !== expected.width || png.height !== expected.height) {
      throw new Error(`Review PNG dimensions are invalid: ${expected.name}`)
    }
    if (png.nonBackgroundPixelCount <= 1_000 || png.uniqueRgbCount <= 16) {
      throw new Error(`Review PNG is blank: ${expected.name}`)
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex")
    if (hashes.has(sha256)) throw new Error("Review PNG hashes must be unique.")
    hashes.add(sha256)
    images.push({ bytes: bytes.length, ...expected, ...png, sha256 })
  }
  assertGeometryParity(input.observations)
  return {
    geometryTolerancePx: 1,
    images,
    observations: input.observations,
    parentSha: input.parentSha,
    schemaVersion: 1,
    sourceManifest: input.sourceManifest,
    verdict: "APPROVE",
  }
}

function assertObservation(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.name !== "string" ||
    path.basename(value.name) !== value.name ||
    !value.name.endsWith(".png")
  ) {
    throw new Error("Review visual observation path is invalid.")
  }
  const layout = value.layout
  if (
    !layout ||
    layout.horizontalOverflow > 0 ||
    layout.focusVisible !== true ||
    layout.minimumTargetHeight < 44 ||
    layout.minimumTargetWidth < 44 ||
    layout.semanticColors !== true ||
    layout.overlaps.length !== 0 ||
    layout.cjkClipping.length !== 0
  ) {
    throw new Error(`Review visual layout rejected: ${value.name}`)
  }
  if (value.state === "populated") assertPopulatedContent(value.content)
  else if (value.state === "empty" && value.recovery?.emptyState !== true)
    throw new Error("Empty state missing.")
  else if (
    value.state === "read-failure" &&
    (value.recovery?.realGrantRevoke !== true || value.recovery?.recoveryUi !== true)
  ) {
    throw new Error("Read-failure recovery is not real.")
  } else if (
    value.state === "loading" &&
    (value.recovery?.ariaBusyObserved !== true ||
      value.recovery?.externalDbLock !== true ||
      value.recovery?.navigationStartedBeforeAwait !== true ||
      value.recovery?.distinctFromReadFailure !== true)
  ) {
    throw new Error("Loading state is not backed by a real external lock.")
  }
}

function assertPopulatedContent(content) {
  const keys = [
    "ctaAbsence",
    "ctaPresence",
    "dateSemantics",
    "hiddenOwnerReason",
    "nullableFallback",
    "pagination",
    "starSemantics",
    "statusSemantics",
    "unavailableLesson",
    "visibleRow",
  ]
  if (!content || keys.some((key) => content[key] !== true)) {
    throw new Error("Populated review fixture obligations are incomplete.")
  }
}

function assertGeometryParity(observations) {
  for (const width of [390, 768, 1280]) {
    const light = observations.find(
      (item) => item.state === "populated" && item.theme === "light" && item.width === width,
    )
    const dark = observations.find(
      (item) => item.state === "populated" && item.theme === "dark" && item.width === width,
    )
    if (!light || !dark) throw new Error(`Missing light/dark pair for ${width}.`)
    for (const key of ["contentLeft", "contentTop", "contentWidth"]) {
      if (Math.abs(light.geometry[key] - dark.geometry[key]) > 1) {
        throw new Error(`Light/dark geometry delta exceeds 1px for ${width}.`)
      }
    }
  }
}

function assertParentSha(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value))
    throw new Error("Parent SHA is invalid.")
}

function assertSourceManifest(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (entry) =>
        !entry ||
        typeof entry.file !== "string" ||
        path.isAbsolute(entry.file) ||
        entry.file.includes("..") ||
        typeof entry.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(entry.sha256),
    )
  ) {
    throw new Error("Review source manifest is invalid.")
  }
}
