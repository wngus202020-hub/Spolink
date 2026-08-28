import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createUpdateScheduleRouteHandler } from "@/lib/lessons/authoring-route-handlers"

export const PATCH = createUpdateScheduleRouteHandler(lessonAuthoringRouteDependencies)
