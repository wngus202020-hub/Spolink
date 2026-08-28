import { z } from "zod"

export const LESSON_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const LESSON_IMAGE_MAX_IDS = 5
export const LESSON_IMAGE_SIGNED_UPLOAD_TTL_SECONDS = 7_200

export const LESSON_IMAGE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export const LESSON_IMAGE_EXTENSION_BY_MIME_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<(typeof LESSON_IMAGE_ALLOWED_MIME_TYPES)[number], string>

export const lessonImageMimeTypeSchema = z.enum(LESSON_IMAGE_ALLOWED_MIME_TYPES)
export const lessonImageResponseTimestampSchema = z.iso.datetime({ offset: true })

const lessonImageUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const lessonImageObjectNamePattern = new RegExp(
  `^${lessonImageUuidPattern}/${lessonImageUuidPattern}\\.(jpg|png|webp)$`,
)

const lessonImageIdsSchema = z
  .array(z.uuid())
  .max(LESSON_IMAGE_MAX_IDS)
  .superRefine((imageIds, context) => {
    if (new Set(imageIds).size === imageIds.length) return
    context.addIssue({ code: "custom", message: "Lesson image IDs must be unique." })
  })

export const lessonImageObjectNameSchema = z.string().regex(lessonImageObjectNamePattern)

export const lessonImageUploadIntentRequestSchema = z.strictObject({
  mimeType: lessonImageMimeTypeSchema,
  sizeBytes: z.number().int().min(1).max(LESSON_IMAGE_MAX_BYTES),
})

export const lessonImageRegistrationRequestSchema = z.strictObject({
  intentId: z.uuid(),
  objectName: lessonImageObjectNameSchema,
})

export const lessonImageOrderRequestSchema = z
  .strictObject({
    expectedImageIds: lessonImageIdsSchema,
    orderedImageIds: lessonImageIdsSchema,
  })
  .refine(
    ({ expectedImageIds, orderedImageIds }) =>
      expectedImageIds.length === orderedImageIds.length &&
      expectedImageIds.every((imageId) => orderedImageIds.includes(imageId)),
    { message: "Ordered lesson image IDs must match the expected image IDs." },
  )

export const lessonImageDeleteRequestSchema = z.strictObject({
  expectedImageIds: lessonImageIdsSchema,
})

export const LESSON_IMAGE_ERROR_STATUS_BY_CODE = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VALIDATION_ERROR: 422,
  UNAVAILABLE: 503,
} as const

export const lessonImageErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "UNSUPPORTED_MEDIA_TYPE",
  "VALIDATION_ERROR",
  "UNAVAILABLE",
])

export const lessonImageErrorResultSchema = z
  .strictObject({
    code: lessonImageErrorCodeSchema,
    status: z.literal("error"),
    statusCode: z.union([
      z.literal(401),
      z.literal(403),
      z.literal(404),
      z.literal(409),
      z.literal(415),
      z.literal(422),
      z.literal(503),
    ]),
  })
  .refine(({ code, statusCode }) => LESSON_IMAGE_ERROR_STATUS_BY_CODE[code] === statusCode, {
    message: "Lesson image error code and HTTP status must match.",
  })

export type LessonImageMimeType = z.infer<typeof lessonImageMimeTypeSchema>
export type LessonImageExtension = (typeof LESSON_IMAGE_EXTENSION_BY_MIME_TYPE)[LessonImageMimeType]
export type LessonImageUploadIntentRequest = Readonly<
  z.infer<typeof lessonImageUploadIntentRequestSchema>
>
export type LessonImageRegistrationRequest = Readonly<
  z.infer<typeof lessonImageRegistrationRequestSchema>
>
export type LessonImageOrderRequest = Readonly<z.infer<typeof lessonImageOrderRequestSchema>>
export type LessonImageDeleteRequest = Readonly<z.infer<typeof lessonImageDeleteRequestSchema>>
export type LessonImageErrorCode = z.infer<typeof lessonImageErrorCodeSchema>
export type LessonImageErrorResult = Readonly<z.infer<typeof lessonImageErrorResultSchema>>
export type LessonImageSuccessResult<T> = Readonly<{ data: T; status: "success" }>
export type LessonImageResult<T> = LessonImageSuccessResult<T> | LessonImageErrorResult

export function hasLessonImageMimeTypeExtension(
  objectName: string,
  mimeType: LessonImageMimeType,
): boolean {
  return (
    lessonImageObjectNameSchema.safeParse(objectName).success &&
    objectName.endsWith(`.${LESSON_IMAGE_EXTENSION_BY_MIME_TYPE[mimeType]}`)
  )
}
