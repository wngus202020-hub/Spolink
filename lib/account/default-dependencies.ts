import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest, NextResponse } from "next/server"

import { clearAuthFlowCookies, clearSupabaseCookies } from "../auth/cookies"
import type { Database } from "../supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "../supabase/env"
import { createSupabaseServerClient } from "../supabase/server"
import type { AccountRouteDependencies } from "./route-handler"
import type { AccountWithdrawalDependencies } from "./withdrawal"

type AppSupabaseClient = SupabaseClient<Database>

export const defaultAccountRouteDependencies: AccountRouteDependencies = {
  clearSession: (response, request) => clearSession(response, request),
  createContext: async (headers) => {
    const supabase = await createSupabaseServerClient(headers)
    return {
      signOut: () => signOutLocal(supabase),
      workflow: createAccountWithdrawalDependencies(supabase),
    }
  },
  isSupabaseConfigured: () => getSupabaseConfigStatus().configured,
}

export function createAccountWithdrawalDependencies(
  supabase: AppSupabaseClient,
): AccountWithdrawalDependencies {
  return {
    getVerifiedUserId: async () => {
      const { data, error } = await supabase.auth.getClaims()
      const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null
      return error || !userId ? null : userId
    },
    readProfile: async (userId) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("avatar_path")
        .eq("id", userId)
        .maybeSingle()
      if (error) return { status: "failure" }
      return data ? { avatarPath: data.avatar_path, status: "found" } : { status: "missing" }
    },
    removeAvatar: async (avatarPath) => {
      const { error } = await supabase.storage.from("profile-avatars").remove([avatarPath])
      return { status: error ? "failure" : "success" }
    },
    withdrawAccount: async () => {
      const { data, error } = await supabase.rpc("withdraw_current_account")
      const withdrawal = data?.[0]
      return error || !withdrawal
        ? { errorCode: error?.code ?? "unknown", status: "failure" }
        : { status: "success", withdrawal }
    },
  }
}

function clearSession(response: NextResponse, request: NextRequest) {
  clearSupabaseCookies(response, request, readSupabasePublicEnv().supabaseUrl, "all")
  clearAuthFlowCookies(response, request)
}

async function signOutLocal(supabase: AppSupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    if (error instanceof Error) return
    throw error
  }
}
