import type { SupabaseClient } from "@supabase/supabase-js"
import { runOpportunisticLessonImageCleanup } from "../storage/lesson-image-validation"
import { cleanupExpiredLessonImageUploads } from "../storage/lesson-images"
import type { Database } from "../supabase/database.types"

type AppClient = SupabaseClient<Database>
export type LessonImageServiceClientFactory = () => AppClient

export function createLessonImageCleanupDependencies(
  createServiceClient: LessonImageServiceClientFactory,
) {
  return {
    reportOpportunisticCleanupError: () => {},
    runOpportunisticCleanup: async (limit: number) => {
      const service = createServiceClient()
      await cleanupExpiredLessonImageUploads(limit, {
        claimExpiredUploadIntents: async (checkedLimit) => {
          const { data, error } = await service.rpc("claim_expired_lesson_image_upload_intents", {
            checked_limit: checkedLimit,
          })
          if (error) throw new Error("Cleanup claim failed.")
          return (data ?? []).map((row) => ({
            claimToken: row.claim_token,
            id: row.id,
            objectName: row.object_name,
          }))
        },
        finalizeCleanup: async (intentId, claimToken, cleaned) => {
          const { error } = await service.rpc("finalize_lesson_image_upload_intent_cleanup", {
            checked_claim_token: claimToken,
            checked_cleaned: cleaned,
            checked_intent_id: intentId,
          })
          if (error) throw new Error("Cleanup finalization failed.")
        },
        removeObject: createLessonImageRemoveObject(createServiceClient),
      })
    },
  }
}

export function runBoundedLessonImageCleanup(
  dependencies: ReturnType<typeof createLessonImageCleanupDependencies>,
) {
  return runOpportunisticLessonImageCleanup(dependencies)
}

export const nestedLessonImageCleanupDependencies = {
  reportOpportunisticCleanupError: () => {},
  runOpportunisticCleanup: async () => {},
} as const

export function createLessonImageRemoveObject(
  createServiceClient: LessonImageServiceClientFactory,
) {
  return async (bucket: string, objectName: string) => {
    const { error } = await createServiceClient().storage.from(bucket).remove([objectName])
    if (!error) return "removed" as const
    if (isLessonImageStorageNotFound(error)) return "not_found" as const
    throw new Error("Storage removal failed.")
  }
}

export function isLessonImageStorageNotFound(
  error: Readonly<{
    status?: number | undefined
    statusCode?: number | string | undefined
  }>,
) {
  return error.status === 404 || error.statusCode === 404 || error.statusCode === "404"
}
