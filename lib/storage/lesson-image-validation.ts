import { z } from "zod"
import {
  hasLessonImageMimeTypeExtension,
  LESSON_IMAGE_MAX_BYTES,
  lessonImageMimeTypeSchema,
  lessonImageObjectNameSchema,
} from "../lessons/lesson-image-contract"

export const LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT = 5
export const LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS = 25

const expectedBlobSchema = z.strictObject({
  mimeType: lessonImageMimeTypeSchema,
  objectName: lessonImageObjectNameSchema,
  sizeBytes: z.number().int().min(1).max(LESSON_IMAGE_MAX_BYTES),
})

export type LessonImageStorageErrorCode =
  | "cleanup_failed"
  | "delete_finalize_retryable"
  | "delete_retryable"
  | "intent_not_found"
  | "invalid_blob"
  | "invalid_input"
  | "object_not_found"
  | "registration_failed"
  | "signing_failed"

export class LessonImageStorageError extends Error {
  readonly code: LessonImageStorageErrorCode
  readonly retryable: boolean

  constructor(code: LessonImageStorageErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "LessonImageStorageError"
    this.code = code
    this.retryable = retryable
  }
}

export type OpportunisticLessonImageCleanupDependencies = Readonly<{
  reportOpportunisticCleanupError: (error: LessonImageStorageError) => void
  runOpportunisticCleanup: (limit: number) => Promise<void>
}>

type OpportunisticCleanupFlight = {
  readonly dependencies: OpportunisticLessonImageCleanupDependencies
  readonly promise: Promise<void>
  reported: boolean
}

let activeOpportunisticCleanup: OpportunisticCleanupFlight | undefined

export async function runOpportunisticLessonImageCleanup(
  dependencies: OpportunisticLessonImageCleanupDependencies,
): Promise<void> {
  const flight = activeOpportunisticCleanup ?? startOpportunisticCleanup(dependencies)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const budget = new Promise<void>((_resolve, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new LessonImageStorageError(
              "cleanup_failed",
              "Opportunistic lesson image cleanup timed out.",
              true,
            ),
          ),
        LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_TIMEOUT_MS,
      )
    })
    await Promise.race([flight.promise, budget])
  } catch {
    reportCleanupFailure(flight)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function startOpportunisticCleanup(
  dependencies: OpportunisticLessonImageCleanupDependencies,
): OpportunisticCleanupFlight {
  const promise = Promise.resolve().then(() =>
    dependencies.runOpportunisticCleanup(LESSON_IMAGE_OPPORTUNISTIC_CLEANUP_LIMIT),
  )
  const flight: OpportunisticCleanupFlight = { dependencies, promise, reported: false }
  activeOpportunisticCleanup = flight
  void promise.then(
    () => clearOpportunisticCleanup(flight),
    () => {
      reportCleanupFailure(flight)
      clearOpportunisticCleanup(flight)
    },
  )
  return flight
}

function clearOpportunisticCleanup(flight: OpportunisticCleanupFlight): void {
  if (activeOpportunisticCleanup === flight) activeOpportunisticCleanup = undefined
}

function reportCleanupFailure(flight: OpportunisticCleanupFlight): void {
  if (flight.reported) return
  flight.reported = true
  try {
    flight.dependencies.reportOpportunisticCleanupError(
      new LessonImageStorageError(
        "cleanup_failed",
        "Opportunistic lesson image cleanup failed.",
        true,
      ),
    )
  } catch {
    return
  }
}

export type ValidatedLessonImage = Readonly<{
  mimeType: "image/jpeg" | "image/png" | "image/webp"
  objectName: string
  sizeBytes: number
}>

export async function validateLessonImageBlob(
  blob: Blob,
  expected: unknown,
): Promise<ValidatedLessonImage> {
  const parsed = expectedBlobSchema.safeParse(expected)
  if (
    !parsed.success ||
    blob.size === 0 ||
    blob.size > LESSON_IMAGE_MAX_BYTES ||
    blob.size !== parsed.data.sizeBytes ||
    blob.type !== parsed.data.mimeType ||
    !hasLessonImageMimeTypeExtension(parsed.data.objectName, parsed.data.mimeType)
  ) {
    throw new LessonImageStorageError("invalid_blob", "Lesson image blob is invalid.")
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (!hasMagicBytes(parsed.data.mimeType, bytes)) {
    throw new LessonImageStorageError("invalid_blob", "Lesson image signature is invalid.")
  }

  return parsed.data
}

function hasMagicBytes(mimeType: ValidatedLessonImage["mimeType"], bytes: Uint8Array): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return hasJpegStructure(bytes)
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case "image/webp":
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
  }
}

function hasJpegStructure(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, [0xff, 0xd8])) return false

  let offset = 2
  let sawStartOfFrame = false
  let sawStartOfScan = false
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false
    while (bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) return false

    const marker = bytes[offset] ?? -1
    offset += 1
    if (marker === 0xd9) {
      return sawStartOfFrame && sawStartOfScan && offset === bytes.length
    }
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      return false
    }
    if (offset + 2 > bytes.length) return false

    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
    if (segmentLength < 2) return false
    const segmentEnd = offset + segmentLength
    if (segmentEnd > bytes.length) return false

    if (isStartOfFrameMarker(marker)) {
      if (segmentLength < 8) return false
      sawStartOfFrame = true
    }
    if (marker === 0xda) {
      if (!sawStartOfFrame || segmentLength < 6) return false
      sawStartOfScan = true
      offset = findNextJpegMarker(bytes, segmentEnd)
      if (offset < 0) return false
    } else {
      offset = segmentEnd
    }
  }
  return false
}

function findNextJpegMarker(bytes: Uint8Array, start: number): number {
  let offset = start
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1] ?? -1
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xff) {
      offset += 1
      continue
    }
    return offset
  }
  return -1
}

function isStartOfFrameMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value)
}
