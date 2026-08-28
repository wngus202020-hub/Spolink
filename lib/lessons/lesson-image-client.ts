import { z } from "zod"

import {
  LESSON_IMAGE_ERROR_STATUS_BY_CODE,
  type LessonImageDeleteRequest,
  type LessonImageOrderRequest,
  type LessonImageRegistrationRequest,
  type LessonImageResult,
  type LessonImageUploadIntentRequest,
  lessonImageErrorCodeSchema,
  lessonImageResponseTimestampSchema,
} from "./lesson-image-contract"
import type { LessonImageListData, LessonImageUploadIntentData } from "./lesson-image-types"

export function issueLessonImageUploadIntent(
  lessonId: string,
  input: LessonImageUploadIntentRequest,
) {
  return mutate<LessonImageUploadIntentData>(
    `/api/lessons/${lessonId}/images/upload-intents`,
    "POST",
    input,
    uploadIntentDataSchema,
  )
}

export function registerLessonImage(lessonId: string, input: LessonImageRegistrationRequest) {
  return mutate<LessonImageListData>(
    `/api/lessons/${lessonId}/images`,
    "POST",
    input,
    imageListDataSchema,
  )
}

export function reorderLessonImages(lessonId: string, input: LessonImageOrderRequest) {
  return mutate<LessonImageListData>(
    `/api/lessons/${lessonId}/images/order`,
    "PATCH",
    input,
    imageListDataSchema,
  )
}

export function deleteLessonImage(
  lessonId: string,
  imageId: string,
  input: LessonImageDeleteRequest,
) {
  return mutate<LessonImageListData>(
    `/api/lessons/${lessonId}/images/${imageId}`,
    "DELETE",
    input,
    imageListDataSchema,
  )
}

export async function uploadLessonImageToSignedUrl(
  uploadUrl: string,
  token: string,
  file: Blob,
  options: Readonly<{ upsert: false }>,
) {
  try {
    const response = await fetch(uploadUrl, {
      body: file,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": String(options.upsert),
      },
      method: "PUT",
    })
    return response.ok
      ? ({ status: "success" } as const)
      : ({ code: "UNAVAILABLE", status: "error", statusCode: 503 } as const)
  } catch {
    return { code: "UNAVAILABLE", status: "error", statusCode: 503 } as const
  }
}

async function mutate<T>(
  path: string,
  method: "DELETE" | "PATCH" | "POST",
  input: object,
  dataSchema: z.ZodType<T>,
): Promise<LessonImageResult<T>> {
  try {
    const response = await fetch(path, {
      body: JSON.stringify(input),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method,
    })
    const body: unknown = await response.json()
    if (response.ok) {
      const parsed = z.strictObject({ data: dataSchema }).safeParse(body)
      return parsed.success
        ? { data: parsed.data.data, status: "success" }
        : { code: "UNAVAILABLE", status: "error", statusCode: 503 }
    }
    const parsed = errorEnvelopeSchema.safeParse(body)
    if (
      parsed.success &&
      LESSON_IMAGE_ERROR_STATUS_BY_CODE[parsed.data.error.code] === response.status
    ) {
      return {
        code: parsed.data.error.code,
        status: "error",
        statusCode: LESSON_IMAGE_ERROR_STATUS_BY_CODE[parsed.data.error.code],
      }
    }
    return { code: "UNAVAILABLE", status: "error", statusCode: 503 }
  } catch {
    return { code: "UNAVAILABLE", status: "error", statusCode: 503 }
  }
}

const readyImageSchema = z.strictObject({
  id: z.uuid(),
  objectName: z.string(),
  sortOrder: z.number().int().min(0).max(4),
})
const imageListDataSchema = z.strictObject({ images: z.array(readyImageSchema).max(5) })
const uploadIntentDataSchema = z.strictObject({
  expiresAt: lessonImageResponseTimestampSchema,
  expiresIn: z.literal(7200),
  intentId: z.uuid(),
  objectName: z.string(),
  token: z.string().min(1),
  uploadUrl: z.string().min(1),
})
const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: lessonImageErrorCodeSchema,
    details: z.array(z.unknown()),
    message: z.string(),
  }),
})
