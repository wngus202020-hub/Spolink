import type { SupabaseClient } from "@supabase/supabase-js"
import type { NextRequest } from "next/server"
import { readVerifiedClaims } from "@/lib/auth/claims"
import { clearRecoveryCookie } from "@/lib/auth/cookies"
import { readAuthFlowSecret } from "@/lib/auth/flow-config"
import { RECOVERY_COOKIE, sha256HexUtf8, verifyRecoveryToken } from "@/lib/auth/flow-token"
import { authJsonData, authJsonError } from "@/lib/auth/http"
import {
  hasSameOrigin,
  parseJsonWithSchema,
  passwordUpdateRequestSchema,
} from "@/lib/auth/route-security"
import { createDefaultAuthRouteSupabaseClient } from "@/lib/auth/supabase-route-client"
import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"

type AppSupabaseClient = SupabaseClient<Database>

export type UpdatePasswordDependencies = Readonly<{
  createSupabaseClient: (headers: Headers) => Promise<AppSupabaseClient>
  getSupabaseConfigured: () => boolean
  readSecret: () => Buffer
}>

export const defaultUpdatePasswordDependencies: UpdatePasswordDependencies = {
  createSupabaseClient: createDefaultAuthRouteSupabaseClient,
  getSupabaseConfigured: () => getSupabaseConfigStatus().configured,
  readSecret: readAuthFlowSecret,
}

export function createUpdatePasswordHandler(deps: UpdatePasswordDependencies) {
  return async function POST(request: NextRequest) {
    if (!hasSameOrigin(request)) {
      return authJsonError("FORBIDDEN", "Same-origin request required.", 403)
    }

    const parsed = await parseJsonWithSchema(request, passwordUpdateRequestSchema)
    if (parsed.status === "invalid_json") {
      return authJsonError("VALIDATION_ERROR", "Request body must be valid JSON.", 422)
    }
    if (parsed.status === "invalid_shape") {
      return authJsonError("VALIDATION_ERROR", "Invalid password update request.", 422)
    }
    if (!deps.getSupabaseConfigured()) {
      return authJsonError("SUPABASE_NOT_CONFIGURED", "Supabase is not configured.", 503)
    }

    const secret = readSecretOrNull(deps)
    if (!secret) {
      return authJsonError(
        "AUTH_FLOW_NOT_CONFIGURED",
        "Authentication flow is not configured.",
        503,
      )
    }

    const headers = new Headers()
    const supabase = await deps.createSupabaseClient(headers)
    const claimsResult = await supabase.auth.getClaims()
    const claims = readVerifiedClaims(claimsResult.data?.claims)
    if (claimsResult.error || !claims) {
      const response = authJsonError("UNAUTHORIZED", "Authentication required.", 401)
      clearRecoveryCookie(response, request)
      return response
    }

    const marker = request.cookies.get(RECOVERY_COOKIE)?.value
    if (!marker) return recoveryRequiredResponse(request, headers)

    const verified = verifyRecoveryToken(marker, secret)
    if (
      verified.status === "failure" ||
      verified.payload.sub !== claims.sub ||
      verified.payload.sessionId !== claims.sessionId
    ) {
      return recoveryRequiredResponse(request, headers)
    }

    const consumed = await supabase.rpc("consume_password_recovery_grant", {
      checked_token_hash: sha256HexUtf8(verified.payload.jti),
    })
    if (consumed.error || consumed.data !== true) return recoveryRequiredResponse(request, headers)

    const updated = await supabase.auth.updateUser({ password: parsed.value.password })
    if (updated.error) {
      const response = authJsonError(
        "AUTH_PROVIDER_ERROR",
        "Unable to update password. Start recovery again.",
        502,
        headers,
      )
      clearRecoveryCookie(response, request)
      return response
    }

    const response = authJsonData({ updated: true }, 200, headers)
    clearRecoveryCookie(response, request)
    return response
  }
}

function recoveryRequiredResponse(request: NextRequest, headers: Headers) {
  const response = authJsonError(
    "RECOVERY_REQUIRED",
    "Password recovery authorization required.",
    403,
    headers,
  )
  clearRecoveryCookie(response, request)
  return response
}

function readSecretOrNull(deps: UpdatePasswordDependencies): Buffer | null {
  try {
    return deps.readSecret()
  } catch (error) {
    if (error instanceof Error && error.name === "AuthFlowConfigError") return null
    throw error
  }
}
