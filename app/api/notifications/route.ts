import { notificationRouteDependencies } from "@/lib/notifications/default-dependencies"
import { createListNotificationsRouteHandler } from "@/lib/notifications/route-handlers"

export const dynamic = "force-dynamic"
export const GET = createListNotificationsRouteHandler(notificationRouteDependencies)
