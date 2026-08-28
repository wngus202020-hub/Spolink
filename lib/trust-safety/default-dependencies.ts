import { getSupabaseConfigStatus } from "../supabase/env"
import { createTrustSafetyServerClient } from "./client"
import { createAdminTrustSafetyDependencies, createTrustSafetyDependencies } from "./repository"

export const trustSafetyRouteDependencies = {
  createWorkflowDependencies: async (headers: Headers) =>
    createTrustSafetyDependencies(await createTrustSafetyServerClient(headers)),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}

export const adminTrustSafetyRouteDependencies = {
  createWorkflowDependencies: async (headers: Headers) =>
    createAdminTrustSafetyDependencies(await createTrustSafetyServerClient(headers)),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
