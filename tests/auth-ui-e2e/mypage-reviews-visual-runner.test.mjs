import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { deflateSync } from "node:zlib"
import { inspectRunnerVisualObligations } from "./mypage-reviews-runner-contract-helpers.mjs"
import {
  expectedVisualImages,
  validateAndPublishVisualBundle,
} from "./mypage-reviews-visual-evidence.mjs"

const sourceManifest = [
  { file: "tests/auth-ui-e2e/mypage-reviews.spec.ts", sha256: "a".repeat(64) },
]

test("Given the Todo7 contract, when the real runner AST is inspected, then publication and cleanup are wired", async () => {
  assert.deepEqual(await inspectRunnerVisualObligations(), {
    exactImageCount: 9,
    publishesVisualBundle: true,
    removesFailedPublication: true,
    writesCanonicalManifest: true,
    writesVisualSummary: true,
  })
})

test("Given nine valid staged PNGs, when the actual parser publishes them, then schema, hashes, pixels, and modes pass", async (context) => {
  const fixture = await createBundleFixture()
  context.after(fixture.cleanup)
  const result = await validateAndPublishVisualBundle(fixture.input)

  assert.equal(result.images.length, 9)
  assert.equal(new Set(result.images.map((image) => image.sha256)).size, 9)
  assert.deepEqual(
    result.images.map((image) => image.name),
    expectedVisualImages.map((image) => image.name),
  )
  for (const image of result.images) {
    assert.ok(image.nonBackgroundPixelCount > 1_000)
    assert.ok(image.uniqueRgbCount > 16)
    assert.equal((await stat(path.join(fixture.publishDir, image.name))).mode & 0o777, 0o600)
  }
})

test("Given malformed, duplicate, blank, path, geometry, and source mutations, when parsed, then every mutation rejects and publication is cleaned", async (context) => {
  const mutations = [
    async (fixture) =>
      writeFile(path.join(fixture.stagingDir, expectedVisualImages[0].name), "bad"),
    async (fixture) =>
      writeFile(
        path.join(fixture.stagingDir, expectedVisualImages[1].name),
        await readFile(path.join(fixture.stagingDir, expectedVisualImages[0].name)),
      ),
    async (fixture) =>
      writeFile(
        path.join(fixture.stagingDir, expectedVisualImages[2].name),
        createPng(expectedVisualImages[2].width, expectedVisualImages[2].height, 0, true),
      ),
    async (fixture) =>
      fixture.observations.push({ ...fixture.observations[0], name: "../escape.png" }),
    async (fixture) => {
      const first = fixture.observations[0]
      if (first) first.layout.minimumTargetHeight = 43
    },
    async (fixture) => {
      fixture.input.sourceManifest = [{ ...sourceManifest[0], sha256: "bad" }]
    },
  ]

  for (const mutate of mutations) {
    const fixture = await createBundleFixture()
    context.after(fixture.cleanup)
    await mkdir(fixture.publishDir, { recursive: true })
    await writeFile(path.join(fixture.publishDir, "stale.png"), "stale")
    await mutate(fixture)
    await assert.rejects(validateAndPublishVisualBundle(fixture.input))
    await assert.rejects(stat(fixture.publishDir))
  }
})

async function createBundleFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "spolink-review-visual-contract-"))
  const stagingDir = path.join(root, "staging")
  const publishDir = path.join(root, "published")
  await mkdir(stagingDir, { mode: 0o700 })
  const observations = expectedVisualImages.map((image, index) => createObservation(image, index))
  await Promise.all(
    expectedVisualImages.map((image, index) =>
      writeFile(
        path.join(stagingDir, image.name),
        createPng(image.width, image.height, index + 1, false),
        { mode: 0o600 },
      ),
    ),
  )
  const input = {
    observations,
    parentSha: "b".repeat(40),
    publishDir,
    sourceManifest: [...sourceManifest],
    stagingDir,
  }
  return {
    cleanup: () =>
      import("node:fs/promises").then(({ rm }) => rm(root, { force: true, recursive: true })),
    input,
    observations,
    publishDir,
    stagingDir,
  }
}

function createObservation(image, index) {
  const populated = image.state === "populated"
  return {
    content: populated
      ? {
          ctaAbsence: true,
          ctaPresence: true,
          dateSemantics: true,
          hiddenOwnerReason: true,
          nullableFallback: true,
          pagination: true,
          starSemantics: true,
          statusSemantics: true,
          unavailableLesson: true,
          visibleRow: true,
        }
      : null,
    geometry: { contentLeft: 16, contentTop: 100, contentWidth: image.width - 32 },
    height: image.height,
    layout: {
      cjkClipping: [],
      focusVisible: true,
      horizontalOverflow: 0,
      minimumTargetHeight: 44,
      minimumTargetWidth: 44,
      overlaps: [],
      semanticColors: true,
    },
    name: image.name,
    recovery:
      image.state === "read-failure"
        ? { realGrantRevoke: true, recoveryUi: true }
        : image.state === "loading"
          ? {
              ariaBusyObserved: true,
              distinctFromReadFailure: true,
              externalDbLock: true,
              navigationStartedBeforeAwait: true,
            }
          : image.state === "empty"
            ? { emptyState: true }
            : null,
    state: image.state,
    theme: image.theme,
    width: image.width,
    sequence: index,
  }
}

function createPng(width, height, seed, blank) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const value = blank ? 30 : (x * 3 + y * 5 + seed * 17) % 251
      const offset = row + 1 + x * 3
      raw[offset] = value
      raw[offset + 1] = blank ? value : (value + seed * 7) % 255
      raw[offset + 2] = blank ? value : (value + x + seed * 11) % 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type)
  const output = Buffer.alloc(data.length + 12)
  output.writeUInt32BE(data.length, 0)
  typeBytes.copy(output, 4)
  data.copy(output, 8)
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8)
  return output
}

function crc32(value) {
  let crc = 0xffffffff
  for (const byte of value) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
