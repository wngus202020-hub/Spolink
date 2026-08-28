import { lessonImageRouteDependencies } from "@/lib/lessons/lesson-image-default-dependencies"
import { createIssueLessonImageUploadIntentRouteHandler } from "@/lib/lessons/lesson-image-route-handlers"

export const POST = createIssueLessonImageUploadIntentRouteHandler(lessonImageRouteDependencies)
