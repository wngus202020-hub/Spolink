import type { SupabaseClient } from "@supabase/supabase-js"

import { readVerifiedClaims } from "../auth/claims"
import {
  deleteLessonImage,
  issueLessonImageUploadIntent,
  LessonImageStorageError,
  registerLessonImage,
} from "../storage/lesson-images"
import type { Database } from "../supabase/database.types"
import type { LessonImageErrorCode } from "./lesson-image-contract"
import {
  captureLessonImageRepositoryResult,
  LessonImageRepositoryError,
  mapLessonImageRpcError,
} from "./lesson-image-repository-errors"
import {
  createLessonImageCleanupDependencies,
  createLessonImageRemoveObject,
  isLessonImageStorageNotFound,
  type LessonImageServiceClientFactory,
  nestedLessonImageCleanupDependencies,
  runBoundedLessonImageCleanup,
} from "./lesson-image-storage-repository"
import type {
  LessonImageOperationResult,
  LessonImageWorkflowDependencies,
  ReadyLessonImage,
} from "./lesson-image-types"
import { lessonImageFailure } from "./lesson-image-workflow"

type AppClient = SupabaseClient<Database>
type LessonImageRow = Database["public"]["Tables"]["lesson_images"]["Row"]

export function createLessonImageWorkflowDependencies(
  requestClient: AppClient,
  createServiceClient: LessonImageServiceClientFactory,
): LessonImageWorkflowDependencies {
  const cleanup = createLessonImageCleanupDependencies(createServiceClient)
  return {
    authenticate: async () => {
      const { data, error } = await requestClient.auth.getClaims()
      if (error) return "unavailable"
      return readVerifiedClaims(data?.claims) ? "authenticated" : "unauthenticated"
    },
    runCleanup: () => runBoundedLessonImageCleanup(cleanup),
    issueUploadIntent: async (input) => {
      let createdObjectName: string | null = null
      return captureLessonImageRepositoryResult(async () =>
        issueLessonImageUploadIntent(input, {
          ...nestedLessonImageCleanupDependencies,
          cancelUploadIntent: async (intentId) => {
            if (!createdObjectName) throw new LessonImageRepositoryError("UNAVAILABLE")
            await cancelOwnedUploadIntent(requestClient, {
              intentId,
              lessonId: input.lessonId,
              objectName: createdObjectName,
            })
          },
          createSignedUploadUrl: async (bucket, name, options) => {
            const { data, error } = await requestClient.storage
              .from(bucket)
              .createSignedUploadUrl(name, options)
            if (error) throw new LessonImageStorageError("signing_failed", "Signing failed.", true)
            return { signedUrl: data.signedUrl, token: data.token }
          },
          createUploadIntent: async ({ lessonId, mimeType, sizeBytes }) => {
            const { data, error } = await requestClient.rpc("create_lesson_image_upload_intent", {
              checked_lesson_id: lessonId,
              checked_mime_type: mimeType,
              checked_size_bytes: sizeBytes,
            })
            if (error) throw new LessonImageRepositoryError(mapLessonImageRpcError(error))
            const row = data?.[0]
            if (!row) throw new LessonImageRepositoryError("UNAVAILABLE")
            createdObjectName = row.object_name
            return {
              expiresAt: row.expires_at,
              id: row.id,
              mimeType: row.mime_type,
              objectName: row.object_name,
              sizeBytes: row.size_bytes,
            }
          },
        }),
      )
    },
    registerImage: async ({ intentId: inputIntentId, lessonId, objectName: inputObjectName }) => {
      let registrationError: LessonImageErrorCode | null = null
      const registered = await captureLessonImageRepositoryResult(async () =>
        registerLessonImage(
          { intentId: inputIntentId, objectName: inputObjectName },
          {
            ...nestedLessonImageCleanupDependencies,
            downloadObject: async (bucket, name) => {
              const { data, error } = await createServiceClient()
                .storage.from(bucket)
                .download(name)
              if (!error) return data
              if (isLessonImageStorageNotFound(error)) return null
              throw new LessonImageStorageError("registration_failed", "Storage read failed.", true)
            },
            finalizeUploadIntent: async (intentId) =>
              cancelOwnedUploadIntent(requestClient, {
                intentId,
                lessonId,
                objectName: inputObjectName,
              }),
            registerImage: async (intentId, objectName) => {
              const actorId = await readCurrentActorId(requestClient)
              const { data, error } = await createServiceClient().rpc(
                "register_validated_lesson_image",
                {
                  checked_actor_id: actorId,
                  checked_intent_id: intentId,
                  checked_object_name: objectName,
                },
              )
              if (error) {
                registrationError = mapLessonImageRpcError(error)
                throw new Error("Registration RPC failed.")
              }
              const row = data?.[0]
              if (!row) throw new LessonImageStorageError("registration_failed", "No image row.")
              return row
            },
            removeObject: createLessonImageRemoveObject(createServiceClient),
            resolveCurrentUserIntent: async (intentId, objectName) => {
              const { data, error } = await requestClient
                .from("lesson_image_upload_intents")
                .select("id,lesson_id,object_name,mime_type,size_bytes,expires_at")
                .eq("id", intentId)
                .eq("object_name", objectName)
                .maybeSingle()
              if (error) throw new LessonImageRepositoryError("UNAVAILABLE")
              return data && data.lesson_id === lessonId
                ? {
                    expiresAt: data.expires_at,
                    id: data.id,
                    mimeType: data.mime_type,
                    objectName: data.object_name,
                    sizeBytes: data.size_bytes,
                  }
                : null
            },
          },
        ),
      )
      if (registrationError) return lessonImageFailure(registrationError)
      if (isFailure(registered)) return registered
      return readReadyImages(requestClient, registered.lesson_id)
    },
    reorderImages: async ({ expectedImageIds, lessonId, orderedImageIds }) =>
      captureLessonImageRepositoryResult(async () => {
        const { data, error } = await requestClient.rpc("reorder_lesson_images", {
          checked_expected_image_ids: expectedImageIds,
          checked_lesson_id: lessonId,
          checked_ordered_image_ids: orderedImageIds,
        })
        if (error) throw new LessonImageRepositoryError(mapLessonImageRpcError(error))
        return canonicalReadyImages(data ?? [])
      }),
    deleteImage: async (input) => {
      let finalizeError: LessonImageErrorCode | null = null
      const result = await captureLessonImageRepositoryResult(async () =>
        deleteLessonImage(input, {
          ...nestedLessonImageCleanupDependencies,
          beginDelete: async ({ expectedImageIds, imageId, lessonId }) => {
            const { data, error } = await requestClient.rpc("begin_delete_lesson_image", {
              checked_expected_image_ids: expectedImageIds,
              checked_image_id: imageId,
              checked_lesson_id: lessonId,
            })
            if (error) throw new LessonImageRepositoryError(mapLessonImageRpcError(error))
            const row = data?.[0]
            if (!row) return { images: [], kind: "already_deleted" }
            return { filePath: row.file_path, kind: "deleting" }
          },
          finalizeDelete: async (lessonId, imageId) => {
            const { data, error } = await requestClient.rpc("finalize_delete_lesson_image", {
              checked_image_id: imageId,
              checked_lesson_id: lessonId,
            })
            if (error) {
              finalizeError = mapLessonImageRpcError(error)
              throw new Error("Delete finalization failed.")
            }
            return canonicalReadyImages(data ?? [])
          },
          removeObject: createLessonImageRemoveObject(createServiceClient),
        }),
      )
      return finalizeError ? lessonImageFailure(finalizeError) : result
    },
  }
}

async function readCurrentActorId(requestClient: AppClient): Promise<string> {
  const { data, error } = await requestClient.auth.getClaims()
  const claims = error ? null : readVerifiedClaims(data?.claims)
  if (!claims) throw new LessonImageRepositoryError("UNAVAILABLE")
  return claims.sub
}

async function cancelOwnedUploadIntent(
  client: AppClient,
  input: Readonly<{ intentId: string; lessonId: string; objectName: string }>,
) {
  const { error } = await client.rpc("cancel_lesson_image_upload_intent", {
    checked_intent_id: input.intentId,
    checked_lesson_id: input.lessonId,
    checked_object_name: input.objectName,
  })
  if (error) throw new LessonImageRepositoryError(mapLessonImageRpcError(error))
}

async function readReadyImages(
  client: AppClient,
  lessonId: string,
): Promise<LessonImageOperationResult<readonly ReadyLessonImage[]>> {
  const { data, error } = await client
    .from("lesson_images")
    .select("id,file_path,sort_order,lifecycle_state,lesson_id,created_at")
    .eq("lesson_id", lessonId)
    .eq("lifecycle_state", "ready")
    .order("sort_order")
    .order("id")
  return error ? lessonImageFailure("UNAVAILABLE") : canonicalReadyImages(data ?? [])
}

function canonicalReadyImages(rows: readonly LessonImageRow[]): readonly ReadyLessonImage[] {
  return rows
    .filter((row) => row.lifecycle_state === "ready")
    .toSorted(
      (left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id),
    )
    .map((row) => ({ id: row.id, objectName: row.file_path, sortOrder: row.sort_order }))
}

function isFailure<T>(value: LessonImageOperationResult<T>): value is Exclude<typeof value, T> {
  return (
    typeof value === "object" && value !== null && "status" in value && value.status === "error"
  )
}
