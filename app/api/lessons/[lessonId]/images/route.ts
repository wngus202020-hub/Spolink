import { lessonImageRouteDependencies } from "@/lib/lessons/lesson-image-default-dependencies"
import { createRegisterLessonImageRouteHandler } from "@/lib/lessons/lesson-image-route-handlers"

export const POST = createRegisterLessonImageRouteHandler(lessonImageRouteDependencies)
