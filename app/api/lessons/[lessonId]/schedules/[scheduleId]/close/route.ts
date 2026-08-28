import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createCloseScheduleRouteHandler } from "@/lib/lessons/authoring-route-handlers"

export const POST = createCloseScheduleRouteHandler(lessonAuthoringRouteDependencies)
