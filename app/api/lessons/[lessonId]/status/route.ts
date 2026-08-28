import { lessonAuthoringRouteDependencies } from "@/lib/lessons/authoring-default-dependencies"
import { createTransitionLessonRouteHandler } from "@/lib/lessons/authoring-route-handlers"

export const POST = createTransitionLessonRouteHandler(lessonAuthoringRouteDependencies)
