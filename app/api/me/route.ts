import { defaultProfileRouteDependencies } from "@/lib/profile/default-route-dependencies"
import { createGetCurrentProfileRouteHandler } from "@/lib/profile/route-handlers"

export const GET = createGetCurrentProfileRouteHandler(defaultProfileRouteDependencies)
