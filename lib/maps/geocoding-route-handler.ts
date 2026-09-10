import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin, parseJsonWithSchema } from "../auth/route-security"
import type { AuthoringAccess } from "../lessons/authoring-types"
import { type GeocodedLocation, geocodingRequestSchema } from "./geocoding-contract"

export type GeocodingRouteDependencies = Readonly<{
  geocode: (query: string) => Promise<readonly GeocodedLocation[]>
  getActorAccess: (headers: Headers) => Promise<AuthoringAccess>
  isConfigured: () => boolean
}>

export function createGeocodingRouteHandler(dependencies: GeocodingRouteDependencies) {
  return async function POST(request: Request) {
    if (!hasSameOrigin(request)) return failure("FORBIDDEN", "Same-origin required.", 403)
    if (!hasJsonContentType(request)) {
      return failure("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.", 415)
    }

    const parsed = await parseJsonWithSchema(request, geocodingRequestSchema)
    if (parsed.status !== "success") {
      return failure("VALIDATION_ERROR", "Invalid address search request.", 422)
    }
    if (!dependencies.isConfigured()) {
      return failure("GEOCODING_NOT_CONFIGURED", "Address search is not configured.", 503)
    }

    const headers = new Headers()
    const access = await dependencies.getActorAccess(headers)
    if (access.kind === "unauthenticated") {
      return failure("UNAUTHORIZED", "Authentication required.", 401, headers)
    }
    if (access.kind !== "approved_coach") {
      return failure("FORBIDDEN", "Approved coach access is required.", 403, headers)
    }

    try {
      const locations = await dependencies.geocode(parsed.value.query)
      return apiDataResponse({ data: { locations } }, 200, headers)
    } catch (error) {
      if (error instanceof Error) {
        return failure(
          "GEOCODING_UNAVAILABLE",
          "Address search is temporarily unavailable.",
          502,
          headers,
        )
      }
      throw error
    }
  }
}

function failure(code: string, message: string, statusCode: number, headers?: Headers) {
  return apiErrorResponse({ code, message, statusCode }, headers)
}
