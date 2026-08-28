import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import { fileURLToPath } from "node:url"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && specifier.startsWith(".")) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context)
    }
    return nextResolve(specifier, context)
  },
})

export const {
  cleanupExpiredLessonImageUploads,
  deleteLessonImage,
  issueLessonImageUploadIntent,
  LESSON_IMAGE_BUCKET,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
  LessonImageStorageError,
  registerLessonImage,
  validateLessonImageBlob,
} = await import("../../../lib/storage/lesson-images.ts")

export const { runOpportunisticLessonImageCleanup } = await import(
  "../../../lib/storage/lesson-image-validation.ts"
)

export const lessonId = "10000000-0000-4000-8000-000000000001"
export const intentId = "20000000-0000-4000-8000-000000000001"
export const imageId = "30000000-0000-4000-8000-000000000001"
export const objectId = "40000000-0000-4000-8000-000000000001"
export const objectName = `${lessonId}/${objectId}.webp`
export const expiresAt = "2026-08-25T12:00:00.000Z"
export const webpBytes = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
export const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
export const jpegBytes = [
  ...Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
    "base64",
  ),
]

export function intent(overrides = {}) {
  return {
    expiresAt,
    id: intentId,
    mimeType: "image/webp",
    objectName,
    sizeBytes: webpBytes.length,
    ...overrides,
  }
}

export async function assertLessonImageError(action, code) {
  let captured
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof LessonImageStorageError)
    assert.equal(error.code, code)
    captured = error
    return true
  })
  return captured
}

export async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}
