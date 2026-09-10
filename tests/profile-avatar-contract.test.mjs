import assert from "node:assert/strict"
import test from "node:test"

import {
  buildProfileAvatarObjectName,
  PROFILE_AVATAR_MAX_BYTES,
  parseProfileAvatarFile,
  runRemoveProfileAvatar,
  runReplaceProfileAvatar,
} from "../lib/profile/avatar-contract.ts"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const AVATAR_PATH = `profiles/${USER_ID}/avatar`

test("accepts supported profile avatar files and builds the owner-only object path", () => {
  // Given: a small PNG selected by an authenticated profile owner.
  const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
    type: "image/png",
  })

  // When: the file and object path cross the browser contract.
  const parsed = parseProfileAvatarFile(file)
  const objectName = buildProfileAvatarObjectName(USER_ID)

  // Then: the supported file is accepted and cannot escape the owner's profile prefix.
  assert.deepEqual(parsed, { mimeType: "image/png", sizeBytes: 4, status: "success" })
  assert.equal(objectName, AVATAR_PATH)
})

test("rejects unsupported, empty, oversized, and malformed owner inputs", () => {
  // Given: invalid browser-selected files and a non-UUID owner identifier.
  const scenarios = [
    new Blob([], { type: "image/png" }),
    new Blob([new Uint8Array([1])], { type: "image/gif" }),
    new Blob([new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1)], { type: "image/jpeg" }),
  ]

  // When: each input crosses the avatar contract.
  const results = scenarios.map(parseProfileAvatarFile)

  // Then: each file is rejected and malformed ownership cannot produce an object path.
  assert.deepEqual(
    results.map((result) => result.status),
    ["failure", "failure", "failure"],
  )
  assert.equal(buildProfileAvatarObjectName("not-a-user-id"), null)
})

test("uploads before profile registration and keeps one canonical avatar object", async () => {
  // Given: a valid avatar and recording storage/profile boundaries.
  const calls = []
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" })
  const dependencies = {
    patchAvatarPath: async (avatarPath) => {
      calls.push(["patch", avatarPath])
      return { status: "success" }
    },
    removeObject: async (objectName) => {
      calls.push(["remove", objectName])
      return { status: "success" }
    },
    uploadObject: async (objectName, selectedFile) => {
      calls.push(["upload", objectName, selectedFile.type])
      return { status: "success" }
    },
  }

  // When: the owner replaces their profile avatar.
  const result = await runReplaceProfileAvatar({ file, userId: USER_ID }, dependencies)

  // Then: the canonical object is uploaded before the profile points to it.
  assert.deepEqual(calls, [
    ["upload", AVATAR_PATH, "image/jpeg"],
    ["patch", AVATAR_PATH],
  ])
  assert.deepEqual(result, { avatarPath: AVATAR_PATH, status: "success" })
})

test("compensates a first upload when profile registration fails", async () => {
  // Given: storage succeeds but the profile mutation fails for a profile without an avatar.
  const calls = []
  const file = new Blob([new Uint8Array([0x89])], { type: "image/png" })
  const dependencies = {
    patchAvatarPath: async (avatarPath) => {
      calls.push(["patch", avatarPath])
      return { status: "failure" }
    },
    removeObject: async (objectName) => {
      calls.push(["remove", objectName])
      return { status: "success" }
    },
    uploadObject: async (objectName) => {
      calls.push(["upload", objectName])
      return { status: "success" }
    },
  }

  // When: the first avatar replacement cannot register its path.
  const result = await runReplaceProfileAvatar(
    { currentAvatarPath: null, file, userId: USER_ID },
    dependencies,
  )

  // Then: the orphan object is removed and the user receives a retryable failure.
  assert.deepEqual(calls, [
    ["upload", AVATAR_PATH],
    ["patch", AVATAR_PATH],
    ["remove", AVATAR_PATH],
  ])
  assert.deepEqual(result, { reason: "profile", status: "failure" })
})

test("clears the profile before removing the public avatar object", async () => {
  // Given: an existing avatar and recording profile/storage boundaries.
  const calls = []
  const dependencies = {
    patchAvatarPath: async (avatarPath) => {
      calls.push(["patch", avatarPath])
      return { status: "success" }
    },
    removeObject: async (objectName) => {
      calls.push(["remove", objectName])
      return { status: "success" }
    },
    uploadObject: async () => ({ status: "success" }),
  }

  // When: the owner removes their profile avatar.
  const result = await runRemoveProfileAvatar(AVATAR_PATH, dependencies)

  // Then: public profile references are cleared before object deletion.
  assert.deepEqual(calls, [
    ["patch", null],
    ["remove", AVATAR_PATH],
  ])
  assert.deepEqual(result, { status: "success" })
})
