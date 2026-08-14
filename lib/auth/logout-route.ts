import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { clearAuthFlowCookies, clearSupabaseCookies } from "@/lib/auth/cookies"
import { authJsonError, authRedirect } from "@/lib/auth/http"
import { hasSameOrigin } from "@/lib/auth/route-security"
import { createDefaultAuthRouteSupabaseClient } from "@/lib/auth/supabase-route-client"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "@/lib/supabase/env"

type AppSupabaseClient = SupabaseClient<Database>

export type LogoutDependencies = Readonly<{
  createSupabaseClient: (headers: Headers) => Promise<AppSupabaseClient>
  getSupabaseConfigured: () => boolean
  readPublicEnv: () => Readonly<{ supabaseUrl: string }>
}>

export const defaultLogoutDependencies: LogoutDependencies = {
  createSupabaseClient: createDefaultAuthRouteSupabaseClient,
  getSupabaseConfigured: () => getSupabaseConfigStatus().configured,
  readPublicEnv: readSupabasePublicEnv,
}

export function createLogoutHandler(deps: LogoutDependencies) {
  return async function POST(request: NextRequest) {
    if (!hasSameOrigin(request)) {
      return authJsonError("FORBIDDEN", "Same-origin request required.", 403)
    }

    if (!deps.getSupabaseConfigured()) {
      const response = authRedirect("/")
      clearAuthFlowCookies(response, request)
      return response
    }

    const headers = new Headers()
    const supabase = await deps.createSupabaseClient(headers)
    await signOutLocal(supabase)

    const response = authRedirect("/", 303, headers)
    const supabaseUrl = deps.readPublicEnv().supabaseUrl
    clearSupabaseCookies(response, request, supabaseUrl, "all")
    clearAuthFlowCookies(response, request)
    return response
  }
}

async function signOutLocal(supabase: AppSupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}
