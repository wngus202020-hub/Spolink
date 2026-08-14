import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "@/lib/supabase/env"

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"]
type CoachProfileRow = Database["public"]["Tables"]["coach_profiles"]["Row"]

export type ServerAuthProfile =
  | {
      readonly kind: "unconfigured"
    }
  | {
      readonly kind: "unauthenticated"
    }
  | {
      readonly kind: "profile_required"
      readonly userId: string
    }
  | {
      readonly kind: "account_suspended"
      readonly profile: ProfileRow
    }
  | {
      readonly kind: "account_deleted"
      readonly profile: ProfileRow
    }
  | {
      readonly coachProfile: CoachProfileRow | null
      readonly kind: "ready"
      readonly profile: ProfileRow
    }

class ServerAuthProfileReadError extends Error {
  readonly name = "ServerAuthProfileReadError"
}

export async function createSupabaseServerComponentClient() {
  const env = readSupabasePublicEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
    },
  })
}

export async function readServerAuthProfile(): Promise<ServerAuthProfile> {
  if (!getSupabaseConfigStatus().configured) {
    return { kind: "unconfigured" }
  }

  const supabase = await createSupabaseServerComponentClient()
  const claimsResult = await supabase.auth.getClaims()
  const userId =
    typeof claimsResult.data?.claims.sub === "string" ? claimsResult.data.claims.sub : null

  if (claimsResult.error || !userId) {
    return { kind: "unauthenticated" }
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,role,status,display_name,real_name,phone,avatar_path,default_region,location_agreed_at,marketing_agreed_at,deleted_at,created_at,updated_at",
    )
    .eq("id", userId)
    .maybeSingle()

  if (profileError) {
    throw new ServerAuthProfileReadError("Unable to read authenticated profile", {
      cause: profileError,
    })
  }

  if (!profile) {
    return { kind: "profile_required", userId }
  }

  if (profile.status === "deleted" || profile.deleted_at !== null) {
    return { kind: "account_deleted", profile }
  }

  if (profile.status === "suspended") {
    return { kind: "account_suspended", profile }
  }

  const { data: coachProfile, error: coachProfileError } = await supabase
    .from("coach_profiles")
    .select(
      "id,user_id,status,headline,service_region,bio,career_years,primary_sport_id,intro_video_url,bank_name,bank_account_last4,payout_holder_name,submitted_at,reviewed_at,reviewed_by,rejection_reason,created_at,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle()

  if (coachProfileError) {
    throw new ServerAuthProfileReadError("Unable to read authenticated coach profile", {
      cause: coachProfileError,
    })
  }

  return { coachProfile, kind: "ready", profile }
}
