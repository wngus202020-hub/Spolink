import assert from "node:assert/strict"
import test from "node:test"

import {
  assertLessonImageError,
  jpegBytes,
  lessonId,
  objectId,
  objectName,
  pngBytes,
  validateLessonImageBlob,
  webpBytes,
} from "./fixtures.mjs"

for (const fixture of [
  { bytes: jpegBytes, extension: "jpg", mimeType: "image/jpeg" },
  { bytes: pngBytes, extension: "png", mimeType: "image/png" },
  { bytes: webpBytes, extension: "webp", mimeType: "image/webp" },
]) {
  test(`Given valid ${fixture.mimeType} bytes, when blob is verified, then exact metadata is returned`, async () => {
    const name = `${lessonId}/${objectId}.${fixture.extension}`
    const blob = new Blob([Uint8Array.from(fixture.bytes)], { type: fixture.mimeType })

    const result = await validateLessonImageBlob(blob, {
      mimeType: fixture.mimeType,
      objectName: name,
      sizeBytes: fixture.bytes.length,
    })

    assert.deepEqual(result, {
      mimeType: fixture.mimeType,
      objectName: name,
      sizeBytes: fixture.bytes.length,
    })
  })
}

for (const fixture of [
  { label: "zero bytes", blob: new Blob([], { type: "image/webp" }), expectedSize: 0 },
  {
    label: "maximum plus one",
    blob: new Blob([new Uint8Array(5_242_881)], { type: "image/webp" }),
    expectedSize: 5_242_881,
  },
  {
    label: "wrong MIME",
    blob: new Blob([Uint8Array.from(webpBytes)], { type: "image/png" }),
    expectedSize: 12,
  },
  {
    label: "wrong extension",
    blob: new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" }),
    expectedSize: 12,
    objectName: `${lessonId}/${objectId}.png`,
  },
  {
    label: "intent size mismatch",
    blob: new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" }),
    expectedSize: 11,
  },
  {
    label: "RIFF spoof",
    blob: new Blob([Uint8Array.from([...webpBytes.slice(0, 8), 0x4e, 0x4f, 0x50, 0x45])], {
      type: "image/webp",
    }),
    expectedSize: 12,
  },
]) {
  test(`Given ${fixture.label}, when blob is verified, then it is rejected`, async () => {
    const action = validateLessonImageBlob(fixture.blob, {
      mimeType: "image/webp",
      objectName: fixture.objectName ?? objectName,
      sizeBytes: fixture.expectedSize,
    })

    await assertLessonImageError(action, "invalid_blob")
  })
}

test("Given an exact 5 MiB WebP, when blob is verified, then the inclusive maximum is accepted", async () => {
  const bytes = new Uint8Array(5_242_880)
  bytes.set(webpBytes)
  const blob = new Blob([bytes], { type: "image/webp" })

  const result = await validateLessonImageBlob(blob, {
    mimeType: "image/webp",
    objectName,
    sizeBytes: bytes.length,
  })

  assert.equal(result.sizeBytes, 5_242_880)
})

for (const fixture of [
  { bytes: [0xff, 0xd8], label: "SOI only" },
  { bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a], label: "truncated segment" },
  {
    bytes: [0xff, 0xd8, 0xff, 0xda, 0x00, 0x06, 0x01, 0x01, 0x00, 0x00, 0x00, 0xff, 0xd9],
    label: "missing SOF",
  },
  {
    bytes: [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0xff, 0xd9],
    label: "missing SOS",
  },
  { bytes: jpegBytes.slice(0, -2), label: "missing EOI" },
  { bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xd9], label: "malformed length" },
]) {
  test(`Given JPEG ${fixture.label}, when blob is verified, then it is rejected`, async () => {
    const blob = new Blob([Uint8Array.from(fixture.bytes)], { type: "image/jpeg" })
    const action = validateLessonImageBlob(blob, {
      mimeType: "image/jpeg",
      objectName: `${lessonId}/${objectId}.jpg`,
      sizeBytes: fixture.bytes.length,
    })

    await assertLessonImageError(action, "invalid_blob")
  })
}
