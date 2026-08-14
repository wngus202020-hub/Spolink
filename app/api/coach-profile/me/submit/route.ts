import { createSubmitCoachApplicationRouteHandler } from "@/lib/coach-certification/route-handlers"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const POST = createSubmitCoachApplicationRouteHandler({
  createWorkflowDependencies: () => ({
    getVerifiedAuthUser: async () => {
      const supabase = await createSupabaseServerClient(new Headers())
      const { data, error } = await supabase.auth.getClaims()
      const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null

      return error || !userId ? null : { id: userId }
    },
    submitCoachApplication: async () => {
      const responseHeaders = new Headers()
      const supabase = await createSupabaseServerClient(responseHeaders)
      const { data, error } = await supabase.rpc("submit_coach_application")
      const row = data?.[0]

      return {
        application: row ? mapSubmissionRow(row) : null,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
      }
    },
  }),
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
})

function mapSubmissionRow(
  row: Database["public"]["Functions"]["submit_coach_application"]["Returns"][number],
) {
  return {
    coachStatus: row.coach_status,
    profileRole: row.profile_role,
    profileStatus: row.profile_status,
    submittedAt: row.submitted_at,
  }
}
