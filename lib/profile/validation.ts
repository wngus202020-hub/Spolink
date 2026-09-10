import { z } from "zod"

import { normalizeProfilePhone } from "./phone-contract"
import { canonicalProfileRegionSchema } from "./region-contract"

const phonePattern = /^01[016789]-[0-9]{3,4}-[0-9]{4}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const avatarSegmentPattern = /^[A-Za-z0-9._-]+$/
const createProfilePhoneSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const normalized = normalizeProfilePhone(value)
    if (normalized !== null) return normalized

    context.addIssue({ code: "custom", message: "Invalid mobile phone number." })
    return z.NEVER
  })

const createProfileSchema = z.strictObject({
  defaultRegion: canonicalProfileRegionSchema,
  displayName: trimmedString(2, 30),
  locationAgreed: z.boolean(),
  marketingAgreed: z.boolean(),
  phone: createProfilePhoneSchema,
  realName: trimmedString(2, 50),
})

const patchProfileSchema = z
  .strictObject({
    avatarPath: z.union([z.string().trim().refine(isValidAvatarPathShape), z.null()]).optional(),
    defaultRegion: z.union([canonicalProfileRegionSchema, z.null()]).optional(),
    displayName: trimmedString(2, 30).optional(),
    locationAgreed: z.boolean().optional(),
    marketingAgreed: z.boolean().optional(),
    phone: z.union([z.string().trim().regex(phonePattern), z.null()]).optional(),
    realName: z.union([trimmedString(2, 50), z.null()]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export type CreateProfileRequest = z.infer<typeof createProfileSchema>
export type PatchProfileRequest = z.infer<typeof patchProfileSchema>

export type ProfileParseResult<T> = Readonly<
  | {
      request: T
      status: "success"
    }
  | {
      status: "failure"
    }
>

export function parseCreateProfileRequest(
  value: unknown,
): ProfileParseResult<CreateProfileRequest> {
  const parsed = createProfileSchema.safeParse(value)

  if (!parsed.success) {
    return { status: "failure" }
  }

  return { request: parsed.data, status: "success" }
}

export function parsePatchProfileRequest(value: unknown): ProfileParseResult<PatchProfileRequest> {
  const parsed = patchProfileSchema.safeParse(value)

  if (!parsed.success) {
    return { status: "failure" }
  }

  return { request: parsed.data, status: "success" }
}

function trimmedString(minLength: number, maxLength: number) {
  return z.string().trim().min(minLength).max(maxLength)
}

function isValidAvatarPathShape(value: string): boolean {
  if (value.startsWith("/") || value.includes("\\") || value.includes("//")) {
    return false
  }

  const parts = value.split("/")

  if (
    parts.length < 3 ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return false
  }

  const [scope, userId, ...suffixParts] = parts

  if (scope !== "profiles" || !userId || !uuidPattern.test(userId)) {
    return false
  }

  const suffix = suffixParts.join("/")

  return (
    suffix.length >= 1 &&
    suffix.length <= 180 &&
    suffixParts.every((part) => avatarSegmentPattern.test(part))
  )
}
