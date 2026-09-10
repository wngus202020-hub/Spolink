import { geocodingRouteDependencies } from "@/lib/maps/geocoding-default-dependencies"
import { createGeocodingRouteHandler } from "@/lib/maps/geocoding-route-handler"

export const POST = createGeocodingRouteHandler(geocodingRouteDependencies)
