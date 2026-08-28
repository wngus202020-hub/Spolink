import { createResolveAdminReportRouteHandler } from "@/lib/trust-safety/admin-route-handlers"
import { adminTrustSafetyRouteDependencies } from "@/lib/trust-safety/default-dependencies"

export const POST = createResolveAdminReportRouteHandler(adminTrustSafetyRouteDependencies)
