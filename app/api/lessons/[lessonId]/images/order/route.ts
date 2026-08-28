import { lessonImageRouteDependencies } from "@/lib/lessons/lesson-image-default-dependencies"
import { createReorderLessonImagesRouteHandler } from "@/lib/lessons/lesson-image-route-handlers"

export const PATCH = createReorderLessonImagesRouteHandler(lessonImageRouteDependencies)
