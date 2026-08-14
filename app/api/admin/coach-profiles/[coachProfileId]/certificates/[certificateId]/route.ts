import { adminRouteDependencies } from "@/lib/coach-certification/admin-default-dependencies"
import { createAdminCertificateReadRouteHandler } from "@/lib/coach-certification/admin-route-handlers"

export const GET = createAdminCertificateReadRouteHandler(adminRouteDependencies)
