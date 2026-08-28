import { getSupabaseConfigStatus } from "../supabase/env"
import { createSupabaseServerClient, createSupabaseServiceClient } from "../supabase/server"
import { createLessonImageWorkflowDependencies } from "./lesson-image-repository"
import type { LessonImageRouteDependencies } from "./lesson-image-route-handlers"

export const lessonImageRouteDependencies: LessonImageRouteDependencies = {
  createWorkflowDependencies: async (headers) =>
    createLessonImageWorkflowDependencies(
      await createSupabaseServerClient(headers),
      createSupabaseServiceClient,
    ),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
