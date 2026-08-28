import { z } from "zod"

const { lessonRegions }: typeof import("../lesson-regions") = await import(
  `../lesson-regions.${"ts"}`
)

const canonicalProfileRegions: ReadonlySet<string> = new Set(
  lessonRegions.flatMap((region) => [
    region.queryValue,
    ...region.districts.map((district) => district.queryValue),
  ]),
)

export function isCanonicalProfileRegion(value: string | null): value is string {
  return value !== null && canonicalProfileRegions.has(value)
}

export const canonicalProfileRegionSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .refine(isCanonicalProfileRegion)
