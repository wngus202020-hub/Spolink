import { defaultProfileRouteDependencies } from "@/lib/profile/default-route-dependencies"
import { createPostProfileRouteHandler } from "@/lib/profile/route-handlers"

export const POST = createPostProfileRouteHandler(defaultProfileRouteDependencies)
