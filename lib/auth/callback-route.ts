import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { readVerifiedClaims } from "@/lib/auth/claims"
import { clearAuthFlowCookies, clearSupabaseCookies, setAuthFlowCookie } from "@/lib/auth/cookies"
import { readAuthFlowSecret } from "@/lib/auth/flow-config"
import {
  createRecoveryToken,
  RECOVERY_COOKIE,
  RECOVERY_INTENT_COOKIE,
  sha256HexUtf8,
  verifyRecoveryIntentToken,
} from "@/lib/auth/flow-token"
import { authRedirect } from "@/lib/auth/http"
import { resolveSafeNextPathFromUrl } from "@/lib/auth/redirect"
import { createDefaultAuthRouteSupabaseClient } from "@/lib/auth/supabase-route-client"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "@/lib/supabase/env"

type AppSupabaseClient = SupabaseClient<Database>
type ProfileState = "account_deleted" | "account_suspended" | "profile_required" | "ready"

export type CallbackDependencies = Readonly<{
  createSupabaseClient: (headers: Headers) => Promise<AppSupabaseClient>
  getSupabaseConfigured: () => boolean
  readPublicEnv: () => Readonly<{ supabaseUrl: string }>
  readSecret: () => Buffer
}>

export const defaultCallbackDependencies: CallbackDependencies = {
  createSupabaseClient: createDefaultAuthRouteSupabaseClient,
  getSupabaseConfigured: () => getSupabaseConfigStatus().configured,
  readPublicEnv: readSupabasePublicEnv,
  readSecret: readAuthFlowSecret,
}

export function createCallbackHandler(deps: CallbackDependencies) {
  return async function GET(request: NextRequest) {
    if (!deps.getSupabaseConfigured()) {
      const response = authRedirect("/auth/login?error=auth-not-configured")
      clearAuthFlowCookies(response, request)
      return response
    }

    const supabaseUrl = deps.readPublicEnv().supabaseUrl
    const recoveryCallback = hasExactRecoveryNext(request)
    const code = request.nextUrl.searchParams.get("code")
    if (!code) return invalidCallbackResponse(request, supabaseUrl)

    if (recoveryCallback) return handleRecoveryCallback(request, deps, code, supabaseUrl)
    return handleSessionCallback(request, deps, code, supabaseUrl)
  }
}

async function handleSessionCallback(
  request: NextRequest,
  deps: CallbackDependencies,
  code: string,
  supabaseUrl: string,
) {
  const headers = new Headers()
  const supabase = await deps.createSupabaseClient(headers)
  if (!(await exchangeCode(supabase, code))) return invalidCallbackResponse(request, supabaseUrl)

  const profileState = await readProfileState(supabase)
  if (!profileState) return invalidCallbackResponse(request, supabaseUrl)

  const response = authRedirect(destinationForProfile(profileState, request), 303, headers)
  clearAuthFlowCookies(response, request)
  clearSupabaseCookies(response, request, supabaseUrl, "verifier")
  return response
}

async function handleRecoveryCallback(
  request: NextRequest,
  deps: CallbackDependencies,
  code: string,
  supabaseUrl: string,
) {
  const secret = readSecretOrNull(deps)
  const intent = request.cookies.get(RECOVERY_INTENT_COOKIE)?.value
  if (!secret || !intent || verifyRecoveryIntentToken(intent, secret).status === "failure") {
    return invalidCallbackResponse(request, supabaseUrl)
  }

  const headers = new Headers()
  const supabase = await deps.createSupabaseClient(headers)
  if (!(await exchangeCode(supabase, code))) return invalidCallbackResponse(request, supabaseUrl)

  const claimsResult = await supabase.auth.getClaims()
  const claims = readVerifiedClaims(claimsResult.data?.claims)
  if (claimsResult.error || !claims) return invalidCallbackResponse(request, supabaseUrl)

  const recovery = createRecoveryToken({
    secret,
    sessionId: claims.sessionId,
    sub: claims.sub,
  })
  const issued = await supabase.rpc("issue_password_recovery_grant", {
    checked_expires_at: new Date(recovery.payload.exp * 1_000).toISOString(),
    checked_token_hash: sha256HexUtf8(recovery.jti),
  })
  if (issued.error || issued.data !== true) return invalidCallbackResponse(request, supabaseUrl)

  const response = authRedirect("/auth/update-password", 303, headers)
  clearAuthFlowCookies(response, request)
  clearSupabaseCookies(response, request, supabaseUrl, "verifier")
  setAuthFlowCookie(response, request, RECOVERY_COOKIE, recovery.token)
  return response
}

async function exchangeCode(supabase: AppSupabaseClient, code: string): Promise<boolean> {
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  return !error
}

async function readProfileState(supabase: AppSupabaseClient): Promise<ProfileState | null> {
  const claimsResult = await supabase.auth.getClaims()
  const claims = readVerifiedClaims(claimsResult.data?.claims)
  if (claimsResult.error || !claims) return null

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("status,deleted_at")
    .eq("id", claims.sub)
    .maybeSingle()
  if (error) return null
  if (!profile) return "profile_required"
  if (profile.status === "deleted" || profile.deleted_at !== null) return "account_deleted"
  if (profile.status === "suspended") return "account_suspended"
  return "ready"
}

function destinationForProfile(profileState: ProfileState, request: NextRequest): string {
  switch (profileState) {
    case "account_deleted":
      return "/auth/restricted?reason=account-deleted"
    case "account_suspended":
      return "/auth/restricted?reason=account-suspended"
    case "profile_required":
      return "/onboarding/profile"
    case "ready":
      return resolveSafeNextPathFromUrl(request.url, "/lessons")
  }
}

function invalidCallbackResponse(request: NextRequest, supabaseUrl: string) {
  const response = authRedirect("/auth/login?error=auth-link-invalid")
  clearAuthFlowCookies(response, request)
  clearSupabaseCookies(response, request, supabaseUrl, "verifier")
  return response
}

function readSecretOrNull(deps: CallbackDependencies): Buffer | null {
  try {
    return deps.readSecret()
  } catch (error) {
    if (error instanceof Error && error.name === "AuthFlowConfigError") return null
    throw error
  }
}

function hasExactRecoveryNext(request: NextRequest): boolean {
  const nextValues = request.nextUrl.searchParams.getAll("next")
  return nextValues.length === 1 && nextValues[0] === "/auth/update-password"
}
