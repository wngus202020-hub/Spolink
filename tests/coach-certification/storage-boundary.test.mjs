import assert from "node:assert/strict"
import test from "node:test"

import {
  COACH_CERTIFICATE_BUCKET,
  COACH_CERTIFICATE_MAX_BYTES,
  CoachCertificateStorageError,
  createAdminCertificateSignedRead,
  createCoachCertificateSignedUpload,
  registerCertificateMetadataWithCompensation,
  validateCoachCertificateBlob,
} from "../../lib/storage/coach-certification.ts"

const ownerId = "10000000-0000-4000-8000-000000000001"
const adminId = "10000000-0000-4000-8000-000000000002"
const objectId = "20000000-0000-4000-8000-000000000001"
const objectName = `${ownerId}/${objectId}.png`
const applicant = { coachStatus: "draft", role: "learner", status: "active" }
const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

test("Given an active learner draft, when upload is signed, then the server creates the canonical object name", async () => {
  // Given
  const calls = []

  // When
  const result = await createCoachCertificateSignedUpload(
    { mimeType: "image/png", sizeBytes: pngBytes.length, userId: ownerId },
    {
      createObjectId: () => objectId,
      createSignedUploadUrl: async (bucket, name) => {
        calls.push({ bucket, name })
        return { signedUrl: "/signed-upload", token: "redacted-test-token" }
      },
      readApplicantState: async () => applicant,
    },
  )

  // Then
  assert.deepEqual(calls, [{ bucket: COACH_CERTIFICATE_BUCKET, name: objectName }])
  assert.deepEqual(result, {
    expiresIn: 300,
    objectName,
    token: "redacted-test-token",
    uploadUrl: "/signed-upload",
  })
})

for (const state of [
  null,
  { ...applicant, role: "coach" },
  { ...applicant, status: "pending_coach" },
  { ...applicant, coachStatus: "submitted" },
  { ...applicant, coachStatus: "approved" },
]) {
  test(`Given an ineligible applicant ${JSON.stringify(state)}, when upload is requested, then signing is forbidden`, async () => {
    // Given
    let signed = false

    // When
    const action = createCoachCertificateSignedUpload(
      { mimeType: "image/png", sizeBytes: pngBytes.length, userId: ownerId },
      {
        createObjectId: () => objectId,
        createSignedUploadUrl: async () => {
          signed = true
          return { signedUrl: "/must-not-sign", token: "must-not-sign" }
        },
        readApplicantState: async () => state,
      },
    )

    // Then
    await assertStorageError(action, "forbidden")
    assert.equal(signed, false)
  })
}

for (const fixture of [
  { bytes: pngBytes, extension: "png", mimeType: "image/png" },
  { bytes: [0xff, 0xd8, 0xff, 0xe0], extension: "jpg", mimeType: "image/jpeg" },
  { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], extension: "pdf", mimeType: "application/pdf" },
]) {
  test(`Given a real ${fixture.mimeType} signature, when validated, then its type and size are accepted`, async () => {
    // Given
    const blob = new Blob([Uint8Array.from(fixture.bytes)], { type: fixture.mimeType })

    // When
    const result = await validateCoachCertificateBlob(
      blob,
      `${ownerId}/${objectId}.${fixture.extension}`,
    )

    // Then
    assert.deepEqual(result, {
      extension: fixture.extension,
      mimeType: fixture.mimeType,
      sizeBytes: fixture.bytes.length,
    })
  })
}

test("Given a spoofed PNG MIME, when magic bytes are checked, then validation fails", async () => {
  // Given
  const spoofed = new Blob([Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d])], {
    type: "image/png",
  })

  // When / Then
  await assertStorageError(validateCoachCertificateBlob(spoofed, objectName), "invalid_file")
})

test("Given a file above 10 MiB, when validated, then validation fails before reading bytes", async () => {
  // Given
  const oversized = new Blob([new Uint8Array(COACH_CERTIFICATE_MAX_BYTES + 1)], {
    type: "image/png",
  })

  // When / Then
  await assertStorageError(validateCoachCertificateBlob(oversized, objectName), "invalid_file")
})

for (const invalidName of [
  `${ownerId}/../${objectId}.png`,
  `https://example.test/${ownerId}/${objectId}.png`,
  `${adminId}/${objectId}.png`,
  `${ownerId}/${objectId}.jpeg`,
]) {
  test(`Given invalid object name ${invalidName}, when metadata is registered, then no object is read`, async () => {
    // Given
    let read = false

    // When
    const action = registerCertificateMetadataWithCompensation(
      { objectName: invalidName, userId: ownerId },
      {
        readObject: async () => {
          read = true
          return null
        },
        registerMetadata: async () => {},
        removeObject: async () => {},
      },
    )

    // Then
    await assert.rejects(action, CoachCertificateStorageError)
    assert.equal(read, false)
  })
}

test("Given invalid stored bytes, when metadata registration validates them, then the orphan is removed", async () => {
  // Given
  const removed = []

  // When
  const action = registerCertificateMetadataWithCompensation(
    { objectName, userId: ownerId },
    {
      readObject: async () => new Blob([Uint8Array.from([0x00])], { type: "image/png" }),
      registerMetadata: async () => assert.fail("invalid bytes must not register metadata"),
      removeObject: async (bucket, name) => removed.push({ bucket, name }),
    },
  )

  // Then
  await assertStorageError(action, "invalid_file")
  assert.deepEqual(removed, [{ bucket: COACH_CERTIFICATE_BUCKET, name: objectName }])
})

test("Given valid bytes and a failed metadata write, when compensation runs, then the orphan is removed", async () => {
  // Given
  const removed = []

  // When
  const action = registerCertificateMetadataWithCompensation(
    { objectName, userId: ownerId },
    {
      readObject: async () => new Blob([Uint8Array.from(pngBytes)], { type: "image/png" }),
      registerMetadata: async () => {
        throw new TypeError("synthetic metadata failure")
      },
      removeObject: async (bucket, name) => removed.push({ bucket, name }),
    },
  )

  // Then
  await assertStorageError(action, "metadata_registration_failed")
  assert.deepEqual(removed, [{ bucket: COACH_CERTIFICATE_BUCKET, name: objectName }])
})

test("Given an active admin and registered object, when read is signed, then expiry is exactly 300 seconds", async () => {
  // Given
  const calls = []

  // When
  const result = await createAdminCertificateSignedRead(
    { adminUserId: adminId, objectName },
    {
      createSignedReadUrl: async (bucket, name, expiresIn) => {
        calls.push({ bucket, expiresIn, name })
        return "/signed-read"
      },
      isActiveAdmin: async () => true,
      isRegisteredObject: async () => true,
    },
  )

  // Then
  assert.deepEqual(calls, [{ bucket: COACH_CERTIFICATE_BUCKET, expiresIn: 300, name: objectName }])
  assert.deepEqual(result, { expiresIn: 300, readUrl: "/signed-read" })
})

async function assertStorageError(action, code) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof CoachCertificateStorageError)
    assert.equal(error.code, code)
    return true
  })
}
