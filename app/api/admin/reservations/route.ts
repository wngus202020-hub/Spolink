import { adminReservationRouteDependencies } from "@/lib/reservations/admin-default-dependencies"
import { createListAdminReservationsRouteHandler } from "@/lib/reservations/admin-route-handlers"

export const dynamic = "force-dynamic"
export const GET = createListAdminReservationsRouteHandler(adminReservationRouteDependencies)
