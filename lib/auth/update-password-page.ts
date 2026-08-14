import "server-only"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { readVerifiedClaims } from "@/lib/auth/claims"
import { readAuthFlowSecret } from "@/lib/auth/flow-config"
import { RECOVERY_COOKIE, verifyRecoveryToken } from "@/lib/auth/flow-token"
import { createSupabaseServerComponentClient } from "@/lib/auth/server-profile"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"

const RECOVERY_REQUIRED_LOCATION = "/auth/reset-password?error=recovery-required"

export async function requireUpdatePasswordPageAccess(): Promise<void> {
  if (!getSupabaseConfigStatus().configured) redirect(RECOVERY_REQUIRED_LOCATION)

  const secret = readSecretOrNull()
  if (!secret) redirect(RECOVERY_REQUIRED_LOCATION)

  const cookieStore = await cookies()
  const marker = cookieStore.get(RECOVERY_COOKIE)?.value
  if (!marker) redirect(RECOVERY_REQUIRED_LOCATION)

  const supabase = await createSupabaseServerComponentClient()
  const claimsResult = await supabase.auth.getClaims()
  const claims = readVerifiedClaims(claimsResult.data?.claims)
  if (claimsResult.error || !claims) redirect(RECOVERY_REQUIRED_LOCATION)

  const verified = verifyRecoveryToken(marker, secret)
  if (verified.status === "failure") redirect(RECOVERY_REQUIRED_LOCATION)
  if (verified.payload.sub !== claims.sub) redirect(RECOVERY_REQUIRED_LOCATION)
  if (verified.payload.sessionId !== claims.sessionId) redirect(RECOVERY_REQUIRED_LOCATION)
}

function readSecretOrNull(): Buffer | null {
  try {
    return readAuthFlowSecret()
  } catch (error) {
    if (error instanceof Error && error.name === "AuthFlowConfigError") return null
    throw error
  }
}
