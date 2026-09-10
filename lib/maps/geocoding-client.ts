import ky, { HTTPError } from "ky"

import { type GeocodedLocation, geocodingResponseSchema } from "./geocoding-contract"

type GeocodingClientResult =
  | { readonly locations: readonly GeocodedLocation[]; readonly status: "success" }
  | { readonly message: string; readonly status: "failure" }

export async function searchLessonAddresses(query: string): Promise<GeocodingClientResult> {
  try {
    const response: unknown = await ky
      .post("/api/maps/geocode", {
        credentials: "same-origin",
        json: { query },
        retry: 0,
        timeout: 10_000,
      })
      .json()
    const parsed = geocodingResponseSchema.safeParse(response)
    if (!parsed.success) return failure("주소 검색 결과를 확인하지 못했습니다.")
    return { locations: parsed.data.data.locations, status: "success" }
  } catch (error) {
    if (error instanceof HTTPError && error.response.status === 503) {
      return failure("주소 검색 서버가 준비되지 않았습니다.")
    }
    if (error instanceof Error) return failure("주소 검색을 완료하지 못했습니다.")
    throw error
  }
}

function failure(message: string): GeocodingClientResult {
  return { message, status: "failure" }
}
