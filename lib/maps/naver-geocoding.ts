import "server-only"

import ky from "ky"

import type { GeocodedLocation } from "./geocoding-contract"
import { readNaverGeocodingEnv } from "./geocoding-env"
import { parseNaverGeocodingResponse } from "./naver-geocoding-response"

const endpoint = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"

export async function geocodeWithNaver(query: string): Promise<readonly GeocodedLocation[]> {
  const env = readNaverGeocodingEnv()
  const response: unknown = await ky
    .get(endpoint, {
      headers: {
        "x-ncp-apigw-api-key": env.clientSecret,
        "x-ncp-apigw-api-key-id": env.clientId,
      },
      retry: {
        limit: 1,
        methods: ["get"],
        statusCodes: [408, 429, 500, 502, 503, 504],
      },
      searchParams: { query },
      timeout: 8_000,
    })
    .json()
  return parseNaverGeocodingResponse(response)
}
