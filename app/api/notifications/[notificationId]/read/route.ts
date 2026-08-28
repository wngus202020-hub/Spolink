import { notificationRouteDependencies } from "@/lib/notifications/default-dependencies"
import { createMarkNotificationReadRouteHandler } from "@/lib/notifications/route-handlers"

export const dynamic = "force-dynamic"
export const POST = createMarkNotificationReadRouteHandler(notificationRouteDependencies)
