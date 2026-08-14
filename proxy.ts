import { type NextRequest, NextResponse } from "next/server"
import type { SupabaseConfigStatus } from "@/lib/supabase/env"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { refreshSupabaseSessionInProxy } from "@/lib/supabase/proxy"

const authRouteHandlerBypassPathnames = new Set([
  "/auth/callback",
  "/auth/recovery/start",
  "/auth/update-password/submit",
  "/auth/logout",
  "/auth/restricted",
])

type RootProxyDependencies = Readonly<{
  getConfigStatus: () => SupabaseConfigStatus
  next: () => NextResponse
  refreshSession: (request: NextRequest) => Promise<NextResponse>
}>

const defaultRootProxyDependencies: RootProxyDependencies = {
  getConfigStatus: getSupabaseConfigStatus,
  next: () => NextResponse.next(),
  refreshSession: refreshSupabaseSessionInProxy,
}

export async function proxy(request: NextRequest) {
  return proxyWithDependencies(request, defaultRootProxyDependencies)
}

export async function proxyWithDependencies(
  request: NextRequest,
  dependencies: RootProxyDependencies,
) {
  const pathname = request.nextUrl.pathname

  if (isRouteHandlerBypass(pathname)) {
    return dependencies.next()
  }

  if (!dependencies.getConfigStatus().configured) {
    return dependencies.next()
  }

  return dependencies.refreshSession(request)
}

function isRouteHandlerBypass(pathname: string): boolean {
  return pathname.startsWith("/api/") || authRouteHandlerBypassPathnames.has(pathname)
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
}
