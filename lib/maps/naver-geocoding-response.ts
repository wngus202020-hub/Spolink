import { z } from "zod"

import type { GeocodedLocation } from "./geocoding-contract"

const providerResponseSchema = z.object({
  addresses: z.array(
    z.object({
      jibunAddress: z.string(),
      roadAddress: z.string(),
      x: z.string(),
      y: z.string(),
    }),
  ),
  meta: z.object({
    count: z.number(),
    page: z.number(),
    totalCount: z.number(),
  }),
  status: z.string(),
})

export function parseNaverGeocodingResponse(value: unknown): readonly GeocodedLocation[] {
  const parsed = providerResponseSchema.safeParse(value)
  if (!parsed.success || parsed.data.status !== "OK") throw new NaverGeocodingResponseError()

  return parsed.data.addresses
    .flatMap((candidate): readonly GeocodedLocation[] => {
      const roadAddress = cleanAddress(candidate.roadAddress)
      const jibunAddress = cleanAddress(candidate.jibunAddress)
      const address = roadAddress ?? jibunAddress
      const latitude = Number(candidate.y)
      const longitude = Number(candidate.x)
      if (
        !address ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return []
      }
      return [{ address, jibunAddress, latitude, longitude, roadAddress }]
    })
    .slice(0, 5)
}

function cleanAddress(value: string) {
  const cleaned = value.trim()
  return cleaned.length > 0 ? cleaned : null
}

class NaverGeocodingResponseError extends Error {
  readonly name = "NaverGeocodingResponseError"

  constructor() {
    super("NAVER Maps returned an invalid geocoding response.")
  }
}
