import { adminRouteDependencies } from "@/lib/coach-certification/admin-default-dependencies"
import { createApproveCoachProfileRouteHandler } from "@/lib/coach-certification/admin-route-handlers"

export const POST = createApproveCoachProfileRouteHandler(adminRouteDependencies)
