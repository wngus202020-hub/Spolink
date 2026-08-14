import type { NextRequest, NextResponse } from "next/server"
import { RECOVERY_COOKIE, RECOVERY_INTENT_COOKIE } from "@/lib/auth/flow-token"

export type CookieNameScope = "all" | "verifier"

export function getSupabaseAuthCookieBase(supabaseUrl: string): string {
  const hostname = new URL(supabaseUrl).hostname
  return `sb-${hostname.split(".")[0]}-auth-token`
}

export function findSupabaseCookieNames(
  request: NextRequest,
  supabaseUrl: string,
  scope: CookieNameScope,
): readonly string[] {
  const base = getSupabaseAuthCookieBase(supabaseUrl)
  const matcher =
    scope === "verifier"
      ? new RegExp(`^${escapeRegExp(base)}-code-verifier$`)
      : new RegExp(`^${escapeRegExp(base)}(?:-code-verifier|\\.(?:0|[1-9][0-9]*))?$`)

  return request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => matcher.test(name))
}

export function setAuthFlowCookie(
  response: NextResponse,
  request: NextRequest,
  name: string,
  value: string,
): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
    secure: isHttpsRequest(request),
  })
}

export function clearAuthFlowCookies(response: NextResponse, request: NextRequest): void {
  clearCookie(response, request, RECOVERY_INTENT_COOKIE)
  clearCookie(response, request, RECOVERY_COOKIE)
}

export function clearRecoveryCookie(response: NextResponse, request: NextRequest): void {
  clearCookie(response, request, RECOVERY_COOKIE)
}

export function clearCookie(response: NextResponse, request: NextRequest, name: string): void {
  response.cookies.set(name, "", {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: isHttpsRequest(request),
  })
}

export function clearSupabaseCookies(
  response: NextResponse,
  request: NextRequest,
  supabaseUrl: string,
  scope: CookieNameScope,
): void {
  for (const name of findSupabaseCookieNames(request, supabaseUrl, scope)) {
    clearCookie(response, request, name)
  }
}

function isHttpsRequest(request: NextRequest): boolean {
  return new URL(request.url).protocol === "https:"
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
