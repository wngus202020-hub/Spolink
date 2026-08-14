import { adminRouteDependencies } from "@/lib/coach-certification/admin-default-dependencies"
import { createRejectCoachProfileRouteHandler } from "@/lib/coach-certification/admin-route-handlers"

export const POST = createRejectCoachProfileRouteHandler(adminRouteDependencies)
