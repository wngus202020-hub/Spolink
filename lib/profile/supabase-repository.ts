import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ProfileInsertInput,
  ProfileMutationResult,
  ProfileUpdateInput,
  ProfileWorkflowDependencies,
} from "@/lib/profile/types"
import type { Database } from "@/lib/supabase/database.types"

type SupabaseAppClient = SupabaseClient<Database>

export function createProfileWorkflowDependencies(
  supabase: SupabaseAppClient,
): ProfileWorkflowDependencies {
  return {
    createProfile: async (input) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .insert(toProfileInsert(input))
        .select("*")
        .single()

      return { errorCode: error?.code ?? null, profile }
    },
    getCoachProfile: async (userId) => {
      const { data: coachProfile, error } = await supabase
        .from("coach_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle()

      return { coachProfile, errorCode: error?.code ?? null }
    },
    getCurrentProfile: async (userId) => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle()

      return { errorCode: error?.code ?? null, profile }
    },
    getVerifiedAuthUser: async () => {
      const { data, error } = await supabase.auth.getClaims()
      const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null

      return error || !userId ? null : { id: userId }
    },
    updateProfile: async (userId, patch) => updateProfile(supabase, userId, patch),
  }
}

async function updateProfile(
  supabase: SupabaseAppClient,
  userId: string,
  patch: ProfileUpdateInput,
): Promise<ProfileMutationResult> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single()

  return { errorCode: error?.code ?? null, profile }
}

function toProfileInsert(
  input: ProfileInsertInput,
): Database["public"]["Tables"]["profiles"]["Insert"] {
  return {
    default_region: input.defaultRegion,
    display_name: input.displayName,
    id: input.id,
    location_agreed_at: input.locationAgreedAt,
    marketing_agreed_at: input.marketingAgreedAt,
    phone: input.phone,
    real_name: input.realName,
    role: input.role,
    status: input.status,
  }
}
