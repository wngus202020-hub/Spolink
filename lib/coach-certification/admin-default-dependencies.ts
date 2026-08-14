import { getSupabaseConfigStatus } from "../supabase/env"
import { createSupabaseServerClient, createSupabaseServiceClient } from "../supabase/server"
import { createAdminReviewDependencies } from "./admin-repository"
import type { AdminRouteDependencies } from "./admin-route-handlers"

export const adminRouteDependencies: AdminRouteDependencies = {
  createWorkflowDependencies: async (headers) =>
    createAdminReviewDependencies(
      await createSupabaseServerClient(headers),
      createSupabaseServiceClient(),
    ),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
