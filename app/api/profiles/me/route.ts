import { defaultProfileRouteDependencies } from "@/lib/profile/default-route-dependencies"
import { createPatchProfileRouteHandler } from "@/lib/profile/route-handlers"

export const PATCH = createPatchProfileRouteHandler(defaultProfileRouteDependencies)
