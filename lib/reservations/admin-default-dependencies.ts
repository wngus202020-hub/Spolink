import { getSupabaseConfigStatus } from "../supabase/env"
import { createSupabaseServerClient } from "../supabase/server"
import { createAdminReservationDependencies } from "./admin-operations"

export const adminReservationRouteDependencies = {
  createWorkflowDependencies: async (headers: Headers) =>
    createAdminReservationDependencies(await createSupabaseServerClient(headers)),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
