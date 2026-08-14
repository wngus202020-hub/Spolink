import { adminRouteDependencies } from "@/lib/coach-certification/admin-default-dependencies"
import { createGetAdminCoachProfileRouteHandler } from "@/lib/coach-certification/admin-route-handlers"

export const GET = createGetAdminCoachProfileRouteHandler(adminRouteDependencies)
