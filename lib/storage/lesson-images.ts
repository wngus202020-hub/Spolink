import { z } from "zod"
import {
  LESSON_IMAGE_SIGNED_UPLOAD_TTL_SECONDS,
  lessonImageDeleteRequestSchema,
  lessonImageRegistrationRequestSchema,
  lessonImageUploadIntentRequestSchema,
} from "../lessons/lesson-image-contract"
import type { OpportunisticLessonImageCleanupDependencies } from "./lesson-image-validation"
import {
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
  LessonImageStorageError,
  runOpportunisticLessonImageCleanup,
  validateLessonImageBlob,
} from "./lesson-image-validation"

export {
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT,
  LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
  LessonImageStorageError,
  validateLessonImageBlob,
}

export const LESSON_IMAGE_BUCKET = "lesson-images"

const uploadInputSchema = lessonImageUploadIntentRequestSchema.extend({ lessonId: z.uuid() })
const deleteInputSchema = lessonImageDeleteRequestSchema.extend({
  imageId: z.uuid(),
  lessonId: z.uuid(),
})
const intentSchema = z.object({
  expiresAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  objectName: z.string(),
  sizeBytes: z.number().int(),
})
const cleanupClaimSchema = z.object({
  claimToken: z.uuid(),
  id: z.uuid(),
  objectName: z.string(),
})

export type LessonImageUploadIntent = Readonly<z.infer<typeof intentSchema>>
export type StorageRemoveResult = "not_found" | "removed"
export type SignedLessonImageUpload = Readonly<{
  expiresAt: string
  expiresIn: 7200
  intentId: string
  objectName: string
  token: string
  uploadUrl: string
}>

export type IssueLessonImageUploadDependencies = OpportunisticLessonImageCleanupDependencies &
  Readonly<{
    cancelUploadIntent: (intentId: string) => Promise<void>
    createSignedUploadUrl: (
      bucket: string,
      objectName: string,
      options: Readonly<{ upsert: false }>,
    ) => Promise<Readonly<{ signedUrl: string; token: string }>>
    createUploadIntent: (
      input: Readonly<{ lessonId: string; mimeType: string; sizeBytes: number }>,
    ) => Promise<LessonImageUploadIntent>
  }>

export async function issueLessonImageUploadIntent(
  input: unknown,
  dependencies: IssueLessonImageUploadDependencies,
): Promise<SignedLessonImageUpload> {
  const parsed = uploadInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new LessonImageStorageError("invalid_input", "Lesson image upload input is invalid.")
  }
  await runOpportunisticLessonImageCleanup(dependencies)

  const created = intentSchema.safeParse(await dependencies.createUploadIntent(parsed.data))
  if (!created.success) {
    throw new LessonImageStorageError("invalid_input", "Lesson image intent is invalid.")
  }

  try {
    const signed = await dependencies.createSignedUploadUrl(
      LESSON_IMAGE_BUCKET,
      created.data.objectName,
      { upsert: false },
    )
    return {
      expiresAt: created.data.expiresAt,
      expiresIn: LESSON_IMAGE_SIGNED_UPLOAD_TTL_SECONDS,
      intentId: created.data.id,
      objectName: created.data.objectName,
      token: signed.token,
      uploadUrl: signed.signedUrl,
    }
  } catch {
    await dependencies.cancelUploadIntent(created.data.id).catch(() => undefined)
    throw new LessonImageStorageError("signing_failed", "Lesson image signing failed.", true)
  }
}

export type RegisterLessonImageDependencies<T> = OpportunisticLessonImageCleanupDependencies &
  Readonly<{
    downloadObject: (bucket: string, objectName: string) => Promise<Blob | null>
    finalizeUploadIntent: (intentId: string) => Promise<void>
    registerImage: (intentId: string, objectName: string) => Promise<T>
    removeObject: (bucket: string, objectName: string) => Promise<StorageRemoveResult>
    resolveCurrentUserIntent: (
      intentId: string,
      objectName: string,
    ) => Promise<LessonImageUploadIntent | null>
  }>

export async function registerLessonImage<T>(
  input: unknown,
  dependencies: RegisterLessonImageDependencies<T>,
): Promise<T> {
  const parsed = lessonImageRegistrationRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new LessonImageStorageError(
      "invalid_input",
      "Lesson image registration input is invalid.",
    )
  }
  await runOpportunisticLessonImageCleanup(dependencies)
  const resolved = await dependencies.resolveCurrentUserIntent(
    parsed.data.intentId,
    parsed.data.objectName,
  )
  const intent = intentSchema.safeParse(resolved)
  if (
    !intent.success ||
    intent.data.id !== parsed.data.intentId ||
    intent.data.objectName !== parsed.data.objectName
  ) {
    throw new LessonImageStorageError("intent_not_found", "Lesson image intent was not found.")
  }

  try {
    const blob = await dependencies.downloadObject(LESSON_IMAGE_BUCKET, intent.data.objectName)
    if (!blob) {
      throw new LessonImageStorageError("object_not_found", "Lesson image object was not found.")
    }
    await validateLessonImageBlob(blob, {
      mimeType: intent.data.mimeType,
      objectName: intent.data.objectName,
      sizeBytes: intent.data.sizeBytes,
    })
    return await dependencies.registerImage(intent.data.id, intent.data.objectName)
  } catch (error) {
    const original =
      error instanceof LessonImageStorageError
        ? error
        : new LessonImageStorageError("registration_failed", "Lesson image registration failed.")
    await compensateRegistration(intent.data.id, intent.data.objectName, dependencies)
    throw original
  }
}

async function compensateRegistration<T>(
  intentId: string,
  objectName: string,
  dependencies: RegisterLessonImageDependencies<T>,
): Promise<void> {
  try {
    await dependencies.removeObject(LESSON_IMAGE_BUCKET, objectName)
  } catch {
    return
  }
  await dependencies.finalizeUploadIntent(intentId).catch(() => undefined)
}

export type CleanupLessonImageDependencies = Readonly<{
  claimExpiredUploadIntents: (limit: number) => Promise<readonly unknown[]>
  finalizeCleanup: (intentId: string, claimToken: string, cleaned: boolean) => Promise<void>
  removeObject: (bucket: string, objectName: string) => Promise<StorageRemoveResult>
}>

export async function cleanupExpiredLessonImageUploads(
  limit: number,
  dependencies: CleanupLessonImageDependencies,
): Promise<Readonly<{ claimed: number; cleaned: number; failed: number }>> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new LessonImageStorageError("invalid_input", "Cleanup batch limit is invalid.")
  }
  const rawClaims = await dependencies.claimExpiredUploadIntents(limit)
  let cleaned = 0
  let failed = 0

  for (const rawClaim of rawClaims) {
    const parsedClaim = cleanupClaimSchema.safeParse(rawClaim)
    if (!parsedClaim.success) {
      failed += 1
      continue
    }
    const claim = parsedClaim.data
    let removed = false
    try {
      await dependencies.removeObject(LESSON_IMAGE_BUCKET, claim.objectName)
      removed = true
    } catch {
      removed = false
    }
    try {
      await dependencies.finalizeCleanup(claim.id, claim.claimToken, removed)
      if (removed) cleaned += 1
      else failed += 1
    } catch {
      failed += 1
    }
  }
  return { claimed: rawClaims.length, cleaned, failed }
}

export type BeginLessonImageDeleteResult<T> =
  | Readonly<{ filePath: string; kind: "deleting" }>
  | Readonly<{ images: readonly T[]; kind: "already_deleted" }>

export type DeleteLessonImageDependencies<T> = OpportunisticLessonImageCleanupDependencies &
  Readonly<{
    beginDelete: (
      input: Readonly<z.infer<typeof deleteInputSchema>>,
    ) => Promise<BeginLessonImageDeleteResult<T>>
    finalizeDelete: (lessonId: string, imageId: string) => Promise<readonly T[]>
    removeObject: (bucket: string, objectName: string) => Promise<StorageRemoveResult>
  }>

export async function deleteLessonImage<T>(
  input: unknown,
  dependencies: DeleteLessonImageDependencies<T>,
): Promise<readonly T[]> {
  const parsed = deleteInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new LessonImageStorageError("invalid_input", "Lesson image delete input is invalid.")
  }
  await runOpportunisticLessonImageCleanup(dependencies)
  const begun = await dependencies.beginDelete(parsed.data)
  if (begun.kind === "already_deleted") return begun.images

  try {
    await dependencies.removeObject(LESSON_IMAGE_BUCKET, begun.filePath)
  } catch {
    throw new LessonImageStorageError(
      "delete_retryable",
      "Lesson image deletion must be retried.",
      true,
    )
  }
  try {
    return await dependencies.finalizeDelete(parsed.data.lessonId, parsed.data.imageId)
  } catch {
    throw new LessonImageStorageError(
      "delete_finalize_retryable",
      "Lesson image delete finalization must be retried.",
      true,
    )
  }
}
