import { z } from "zod"

export const geocodingRequestSchema = z.strictObject({
  query: z.string().trim().min(2).max(200),
})

export const geocodedLocationSchema = z.strictObject({
  address: z.string().trim().min(1).max(300),
  jibunAddress: z.string().trim().min(1).max(300).nullable(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  roadAddress: z.string().trim().min(1).max(300).nullable(),
})

export const geocodingResponseSchema = z.strictObject({
  data: z.strictObject({
    locations: z.array(geocodedLocationSchema).max(5),
  }),
})

export type GeocodedLocation = z.infer<typeof geocodedLocationSchema>
