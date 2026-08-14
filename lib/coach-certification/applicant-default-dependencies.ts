import { getSupabaseConfigStatus } from "../supabase/env"
import { createSupabaseServerClient } from "../supabase/server"
import { createApplicantWorkflowDependencies } from "./applicant-repository"
import type { ApplicantRouteDependencies } from "./applicant-route-handlers"

export const applicantRouteDependencies: ApplicantRouteDependencies = {
  createWorkflowDependencies: async (headers) =>
    createApplicantWorkflowDependencies(await createSupabaseServerClient(headers)),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}
