import "server-only"

import { createLessonAuthoringDependencies } from "../lessons/authoring-repository"
import { createLessonAuthoringServerClient } from "../lessons/authoring-server-client"
import { getSupabaseConfigStatus } from "../supabase/env"
import { isNaverGeocodingConfigured } from "./geocoding-env"
import type { GeocodingRouteDependencies } from "./geocoding-route-handler"
import { geocodeWithNaver } from "./naver-geocoding"

export const geocodingRouteDependencies: GeocodingRouteDependencies = {
  geocode: geocodeWithNaver,
  getActorAccess: async (headers) =>
    createLessonAuthoringDependencies(
      await createLessonAuthoringServerClient(headers),
    ).getActorAccess(),
  isConfigured: () => getSupabaseConfigStatus().configured && isNaverGeocodingConfigured(),
}
