import { getSupabaseConfigStatus } from "../supabase/env"
import { createLessonAuthoringDependencies } from "./authoring-repository"
import type { LessonAuthoringRouteDependencies } from "./authoring-route-handlers"
import { createLessonAuthoringServerClient } from "./authoring-server-client"

export const lessonAuthoringRouteDependencies: LessonAuthoringRouteDependencies = {
  createWorkflowDependencies: async (headers) =>
    createLessonAuthoringDependencies(await createLessonAuthoringServerClient(headers)),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
