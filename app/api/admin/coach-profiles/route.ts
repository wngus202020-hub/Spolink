import { adminRouteDependencies } from "@/lib/coach-certification/admin-default-dependencies"
import { createListAdminCoachProfilesRouteHandler } from "@/lib/coach-certification/admin-route-handlers"

export const GET = createListAdminCoachProfilesRouteHandler(adminRouteDependencies)
