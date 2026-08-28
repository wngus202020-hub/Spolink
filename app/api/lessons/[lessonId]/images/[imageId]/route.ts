import { lessonImageRouteDependencies } from "@/lib/lessons/lesson-image-default-dependencies"
import { createDeleteLessonImageRouteHandler } from "@/lib/lessons/lesson-image-route-handlers"

export const DELETE = createDeleteLessonImageRouteHandler(lessonImageRouteDependencies)
