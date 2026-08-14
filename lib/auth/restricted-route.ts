import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { readVerifiedClaims } from "@/lib/auth/claims"
import { clearAuthFlowCookies, clearSupabaseCookies } from "@/lib/auth/cookies"
import { authRedirect } from "@/lib/auth/http"
import { createDefaultAuthRouteSupabaseClient } from "@/lib/auth/supabase-route-client"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "@/lib/supabase/env"

type AppSupabaseClient = SupabaseClient<Database>
type RestrictedReason = "account-deleted" | "account-suspended"

export type RestrictedDependencies = Readonly<{
  createSupabaseClient: (headers: Headers) => Promise<AppSupabaseClient>
  getSupabaseConfigured: () => boolean
  readPublicEnv: () => Readonly<{ supabaseUrl: string }>
}>

export const defaultRestrictedDependencies: RestrictedDependencies = {
  createSupabaseClient: createDefaultAuthRouteSupabaseClient,
  getSupabaseConfigured: () => getSupabaseConfigStatus().configured,
  readPublicEnv: readSupabasePublicEnv,
}

export function createRestrictedHandler(deps: RestrictedDependencies) {
  return async function GET(request: NextRequest) {
    const reason = readReason(request)
    if (!reason || !deps.getSupabaseConfigured()) return authRedirect("/")

    const headers = new Headers()
    const supabase = await deps.createSupabaseClient(headers)
    const claimsResult = await supabase.auth.getClaims()
    const claims = readVerifiedClaims(claimsResult.data?.claims)
    if (claimsResult.error || !claims) return authRedirect("/auth/login", 303, headers)

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("status,deleted_at")
      .eq("id", claims.sub)
      .maybeSingle()
    if (error || !profile || !reasonMatchesProfile(reason, profile))
      return authRedirect("/", 303, headers)

    await signOutLocal(supabase)
    const response = authRedirect(`/auth/login?error=${reason}`, 303, headers)
    clearSupabaseCookies(response, request, deps.readPublicEnv().supabaseUrl, "all")
    clearAuthFlowCookies(response, request)
    return response
  }
}

function readReason(request: NextRequest): RestrictedReason | null {
  const reason = request.nextUrl.searchParams.get("reason")
  if (reason === "account-deleted" || reason === "account-suspended") return reason
  return null
}

function reasonMatchesProfile(
  reason: RestrictedReason,
  profile: Readonly<{ deleted_at: string | null; status: string }>,
): boolean {
  if (reason === "account-deleted")
    return profile.status === "deleted" || profile.deleted_at !== null
  return profile.status === "suspended" && profile.deleted_at === null
}

async function signOutLocal(supabase: AppSupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}
