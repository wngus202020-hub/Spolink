import assert from "node:assert/strict"
import test from "node:test"

import {
  assertLessonImageError,
  imageId,
  intent,
  intentId,
  LessonImageStorageError,
  objectName,
  registerLessonImage,
  webpBytes,
} from "./fixtures.mjs"

test("Given an exact current-user intent and object, when registered, then actual bytes precede RPC", async () => {
  const calls = []
  const row = { file_path: objectName, id: imageId }

  const result = await registerLessonImage(
    { intentId, objectName },
    {
      downloadObject: async () => {
        calls.push("download")
        return new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" })
      },
      finalizeUploadIntent: async () => assert.fail("success must not compensate"),
      registerImage: async () => {
        calls.push("register")
        return row
      },
      removeObject: async () => "removed",
      resolveCurrentUserIntent: async () => intent(),
    },
  )

  assert.deepEqual(calls, ["download", "register"])
  assert.equal(result, row)
})

test("Given no matching current-user intent, when registration starts, then object is not read", async () => {
  let downloaded = false

  const action = registerLessonImage(
    { intentId, objectName },
    {
      downloadObject: async () => {
        downloaded = true
        return null
      },
      finalizeUploadIntent: async () => {},
      registerImage: async () => ({}),
      removeObject: async () => "removed",
      resolveCurrentUserIntent: async () => null,
    },
  )

  await assertLessonImageError(action, "intent_not_found")
  assert.equal(downloaded, false)
})

for (const failure of ["missing", "invalid", "rpc"]) {
  test(`Given ${failure} registration failure, when compensation runs, then object and intent are finalized`, async () => {
    const calls = []
    const rpcError = new LessonImageStorageError("registration_failed", "Registration failed.")

    const action = registerLessonImage(
      { intentId, objectName },
      {
        downloadObject: async () => {
          if (failure === "missing") return null
          if (failure === "invalid")
            return new Blob([Uint8Array.from([0x52, 0x49])], { type: "image/webp" })
          return new Blob([Uint8Array.from(webpBytes)], { type: "image/webp" })
        },
        finalizeUploadIntent: async (id) => calls.push(["finalize", id]),
        registerImage: async () => {
          throw rpcError
        },
        removeObject: async (_bucket, name) => {
          calls.push(["remove", name])
          return failure === "missing" ? "not_found" : "removed"
        },
        resolveCurrentUserIntent: async () => intent(),
      },
    )

    const error = await assertLessonImageError(
      action,
      failure === "missing"
        ? "object_not_found"
        : failure === "invalid"
          ? "invalid_blob"
          : "registration_failed",
    )
    if (failure === "rpc") assert.equal(error, rpcError)
    assert.deepEqual(calls, [
      ["remove", objectName],
      ["finalize", intentId],
    ])
  })
}
