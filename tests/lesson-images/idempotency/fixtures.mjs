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

export const { deleteLessonImage, registerLessonImage } = await import(
  "../../../lib/storage/lesson-images.ts"
)

export const lessonId = "10000000-0000-4000-8000-000000000001"
export const intentId = "20000000-0000-4000-8000-000000000001"
export const imageId = "30000000-0000-4000-8000-000000000001"
export const objectName = `${lessonId}/40000000-0000-4000-8000-000000000001.webp`
export const bytes = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
export const cleanup = {
  reportOpportunisticCleanupError: () => {},
  runOpportunisticCleanup: async () => {},
}

export function registrationDependencies(registered, onRemove = () => {}) {
  return {
    ...cleanup,
    downloadObject: async () => new Blob([Uint8Array.from(bytes)], { type: "image/webp" }),
    finalizeUploadIntent: async () => {},
    registerImage: async () => registered,
    removeObject: async () => {
      onRemove()
      return "removed"
    },
    resolveCurrentUserIntent: async () => ({
      expiresAt: "2026-08-26T12:00:00.000Z",
      id: intentId,
      mimeType: "image/webp",
      objectName,
      sizeBytes: bytes.length,
    }),
  }
}
