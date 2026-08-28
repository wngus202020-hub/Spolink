import { adminReservationRouteDependencies } from "@/lib/reservations/admin-default-dependencies"
import { createAdminReservationStatusRouteHandler } from "@/lib/reservations/admin-route-handlers"

export const POST = createAdminReservationStatusRouteHandler(adminReservationRouteDependencies)
