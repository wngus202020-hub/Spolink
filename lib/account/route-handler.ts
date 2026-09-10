import type { NextRequest, NextResponse } from "next/server"

import { readRequestJson } from "../api/json"
import { apiDataResponse, apiErrorResponse } from "../api/responses"
import { hasJsonContentType, hasSameOrigin } from "../auth/route-security"
import {
  type AccountWithdrawalDependencies,
  parseAccountWithdrawalRequest,
  runAccountWithdrawal,
} from "./withdrawal"

type AccountRouteContext = Readonly<{
  signOut: () => Promise<void>
  workflow: AccountWithdrawalDependencies
}>

export type AccountRouteDependencies = Readonly<{
  clearSession: (response: NextResponse, request: NextRequest) => void
  createContext: (headers: Headers) => Promise<AccountRouteContext>
  isSupabaseConfigured: () => boolean
}>

export function createAccountWithdrawalRouteHandler(dependencies: AccountRouteDependencies) {
  return async function DELETE(request: NextRequest) {
    if (!hasSameOrigin(request)) return boundaryError("FORBIDDEN", 403)
    if (!hasJsonContentType(request)) return boundaryError("UNSUPPORTED_MEDIA_TYPE", 415)

    const requestJson = await readRequestJson(request)
    if (requestJson.status === "failure") return boundaryError("VALIDATION_ERROR", 422)

    const parsed = parseAccountWithdrawalRequest(requestJson.value)
    if (parsed.status === "failure") return boundaryError("VALIDATION_ERROR", 422)
    if (!dependencies.isSupabaseConfigured()) {
      return boundaryError("SUPABASE_NOT_CONFIGURED", 503)
    }

    const responseHeaders = new Headers()
    const context = await dependencies.createContext(responseHeaders)
    const result = await runAccountWithdrawal(context.workflow)
    if (result.status === "failure") return apiErrorResponse(result.error, responseHeaders)

    await context.signOut()
    const response = apiDataResponse(result.response, result.statusCode, responseHeaders)
    dependencies.clearSession(response, request)
    return response
  }
}

function boundaryError(code: string, statusCode: number) {
  const messages: Readonly<Record<string, string>> = {
    FORBIDDEN: "Same-origin request required.",
    SUPABASE_NOT_CONFIGURED: "Supabase is not configured.",
    UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
    VALIDATION_ERROR: "Invalid account withdrawal request.",
  }
  return apiErrorResponse({ code, message: messages[code] ?? "Invalid request.", statusCode })
}
