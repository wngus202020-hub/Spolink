import { z } from "zod"

import { canonicalProfileRegionSchema } from "./region-contract"

export const PROFILE_EDIT_PATCH_KEYS = [
  "displayName",
  "realName",
  "phone",
  "defaultRegion",
  "locationAgreed",
  "marketingAgreed",
] as const

const phonePattern = /^01[016789]-[0-9]{3,4}-[0-9]{4}$/

const profileEditFormSchema = z.strictObject({
  defaultRegion: canonicalProfileRegionSchema,
  displayName: z.string().trim().min(2).max(30),
  locationAgreed: z.boolean(),
  marketingAgreed: z.boolean(),
  phone: z.string().trim().regex(phonePattern),
  realName: z.string().trim().min(2).max(50),
})

export const profileEditPatchSchema = z
  .strictObject({
    defaultRegion: profileEditFormSchema.shape.defaultRegion.optional(),
    displayName: profileEditFormSchema.shape.displayName.optional(),
    locationAgreed: z.boolean().optional(),
    marketingAgreed: z.boolean().optional(),
    phone: profileEditFormSchema.shape.phone.optional(),
    realName: profileEditFormSchema.shape.realName.optional(),
  })
  .refine((value) => Object.keys(value).length > 0)

export type ProfileEditInitialData = Readonly<{
  defaultRegion: string | null
  displayName: string
  locationAgreed: boolean
  marketingAgreed: boolean
  phone: string | null
  realName: string | null
}>

export type ProfileEditFormValues = Readonly<z.infer<typeof profileEditFormSchema>>
export type ProfileEditPatch = Readonly<z.infer<typeof profileEditPatchSchema>>
export type ProfileEditField = (typeof PROFILE_EDIT_PATCH_KEYS)[number]

export type ProfileEditParseResult = Readonly<
  | { status: "failure"; fields: readonly ProfileEditField[] }
  | { status: "success"; values: ProfileEditFormValues }
>

type ProfileEditRow = Readonly<{
  default_region: string | null
  display_name: string
  location_agreed_at: string | null
  marketing_agreed_at: string | null
  phone: string | null
  real_name: string | null
}>

type ProfileEditResponseData = Readonly<{
  defaultRegion: string | null
  displayName: string
  locationAgreedAt: string | null
  marketingAgreedAt: string | null
  phone: string | null
  realName: string | null
}>

export function mapProfileEditInitialData(row: ProfileEditRow): ProfileEditInitialData {
  return {
    defaultRegion: normalizeNullableString(row.default_region),
    displayName: row.display_name.trim(),
    locationAgreed: row.location_agreed_at !== null,
    marketingAgreed: row.marketing_agreed_at !== null,
    phone: normalizeNullableString(row.phone),
    realName: normalizeNullableString(row.real_name),
  }
}

export function mapProfileDataToEditInitialData(
  data: ProfileEditResponseData,
): ProfileEditInitialData {
  return {
    defaultRegion: normalizeNullableString(data.defaultRegion),
    displayName: data.displayName.trim(),
    locationAgreed: data.locationAgreedAt !== null,
    marketingAgreed: data.marketingAgreedAt !== null,
    phone: normalizeNullableString(data.phone),
    realName: normalizeNullableString(data.realName),
  }
}

export function parseProfileEditForm(value: unknown): ProfileEditParseResult {
  const parsed = profileEditFormSchema.safeParse(value)

  if (parsed.success) return { status: "success", values: parsed.data }

  const fields = PROFILE_EDIT_PATCH_KEYS.filter((field) =>
    parsed.error.issues.some((issue) => issue.path[0] === field),
  )
  return { fields, status: "failure" }
}

export function buildProfileEditPatch(
  baseline: ProfileEditInitialData,
  values: ProfileEditFormValues,
): ProfileEditPatch | null {
  const patch = {
    ...(normalizeNullableString(baseline.defaultRegion) !== values.defaultRegion
      ? { defaultRegion: values.defaultRegion }
      : {}),
    ...(baseline.displayName.trim() !== values.displayName
      ? { displayName: values.displayName }
      : {}),
    ...(baseline.locationAgreed !== values.locationAgreed
      ? { locationAgreed: values.locationAgreed }
      : {}),
    ...(baseline.marketingAgreed !== values.marketingAgreed
      ? { marketingAgreed: values.marketingAgreed }
      : {}),
    ...(normalizeNullableString(baseline.phone) !== values.phone ? { phone: values.phone } : {}),
    ...(normalizeNullableString(baseline.realName) !== values.realName
      ? { realName: values.realName }
      : {}),
  }

  return Object.keys(patch).length === 0 ? null : patch
}

function normalizeNullableString(value: string | null): string | null {
  return value === null ? null : value.trim()
}
