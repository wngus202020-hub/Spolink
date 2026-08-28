import { adminReservationRouteDependencies } from "@/lib/reservations/admin-default-dependencies"
import { createReadAdminReservationRouteHandler } from "@/lib/reservations/admin-route-handlers"

export const dynamic = "force-dynamic"
export const GET = createReadAdminReservationRouteHandler(adminReservationRouteDependencies)
