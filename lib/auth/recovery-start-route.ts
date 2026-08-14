import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { setAuthFlowCookie } from "@/lib/auth/cookies"
import { readAuthFlowSecret } from "@/lib/auth/flow-config"
import { createRecoveryIntentToken, RECOVERY_INTENT_COOKIE } from "@/lib/auth/flow-token"
import { authJsonData, authJsonError } from "@/lib/auth/http"
import { emailRequestSchema, hasSameOrigin, parseJsonWithSchema } from "@/lib/auth/route-security"
import { createTimedAuthRouteSupabaseClient } from "@/lib/auth/supabase-route-client"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"

type AppSupabaseClient = SupabaseClient<Database>

export type RecoveryStartDependencies = Readonly<{
  createSupabaseClient: (headers: Headers) => Promise<AppSupabaseClient>
  getSupabaseConfigured: () => boolean
  readSecret: () => Buffer
}>

export const defaultRecoveryStartDependencies: RecoveryStartDependencies = {
  createSupabaseClient: createTimedAuthRouteSupabaseClient,
  getSupabaseConfigured: () => getSupabaseConfigStatus().configured,
  readSecret: readAuthFlowSecret,
}

export function createRecoveryStartHandler(deps: RecoveryStartDependencies) {
  return async function POST(request: NextRequest) {
    if (!hasSameOrigin(request)) return forbiddenResponse()

    const parsed = await parseJsonWithSchema(request, emailRequestSchema)
    if (parsed.status === "invalid_json") {
      return authJsonError("VALIDATION_ERROR", "Request body must be valid JSON.", 422)
    }
    if (parsed.status === "invalid_shape") {
      return authJsonError("VALIDATION_ERROR", "Invalid recovery request.", 422)
    }
    if (!deps.getSupabaseConfigured()) return supabaseNotConfiguredResponse()

    const secretResult = readSecret(deps)
    if (!secretResult) return authFlowNotConfiguredResponse()

    const headers = new Headers()
    const supabase = await deps.createSupabaseClient(headers)
    const intent = createRecoveryIntentToken(secretResult)
    const redirectTo = `${new URL(request.url).origin}/auth/callback?next=/auth/update-password`

    await resetPasswordForEmail(supabase, parsed.value.email, redirectTo)
    const response = authJsonData({ accepted: true }, 202, headers)
    setAuthFlowCookie(response, request, RECOVERY_INTENT_COOKIE, intent.token)
    return response
  }
}

async function resetPasswordForEmail(
  supabase: AppSupabaseClient,
  email: string,
  redirectTo: string,
) {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) logProviderFailure(readProviderFailureClass(error))
  } catch (error) {
    if (isAbortError(error)) {
      logProviderFailure("timeout")
      return
    }
    if (error instanceof TypeError) {
      logProviderFailure("network")
      return
    }
    throw error
  }
}

function readSecret(deps: RecoveryStartDependencies): Buffer | null {
  try {
    return deps.readSecret()
  } catch (error) {
    if (error instanceof Error && error.name === "AuthFlowConfigError") return null
    throw error
  }
}

function readProviderFailureClass(error: object): "provider" | "rate_limit" {
  for (const [key, value] of Object.entries(error)) {
    if (key === "status" && value === 429) return "rate_limit"
  }
  return "provider"
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function logProviderFailure(failureClass: "network" | "provider" | "rate_limit" | "timeout"): void {
  console.warn(
    JSON.stringify({ event: "auth.recovery_start.provider_failure", class: failureClass }),
  )
}

function forbiddenResponse() {
  return authJsonError("FORBIDDEN", "Same-origin request required.", 403)
}

function supabaseNotConfiguredResponse() {
  return authJsonError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
}

function authFlowNotConfiguredResponse() {
  return authJsonError("AUTH_FLOW_NOT_CONFIGURED", "Authentication flow is not configured.", 503)
}
