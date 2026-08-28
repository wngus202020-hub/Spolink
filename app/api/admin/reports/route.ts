import { createListAdminReportsRouteHandler } from "@/lib/trust-safety/admin-route-handlers"
import { adminTrustSafetyRouteDependencies } from "@/lib/trust-safety/default-dependencies"

export const dynamic = "force-dynamic"

export const GET = createListAdminReportsRouteHandler(adminTrustSafetyRouteDependencies)
