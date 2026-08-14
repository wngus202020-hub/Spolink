import { getSupabaseConfigStatus } from "../supabase/env"
import { createSupabaseServerClient } from "../supabase/server"
import type { ProfileRouteDependencies } from "./route-handlers"
import { createProfileWorkflowDependencies } from "./supabase-repository"

export const defaultProfileRouteDependencies: ProfileRouteDependencies = {
  createSupabaseClient: createSupabaseServerClient,
  createWorkflowDependencies: createProfileWorkflowDependencies,
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
