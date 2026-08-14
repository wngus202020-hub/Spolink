import type { CookieMethodsServer } from "@supabase/ssr"
import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

import type { Database } from "@/lib/supabase/database.types"
import { readSupabasePublicEnv, type SupabasePublicEnv } from "@/lib/supabase/env"

const AUTH_PROXY_CACHE_CONTROL = "private, no-store"

type SupabaseProxyClient = Readonly<{
  auth: Readonly<{
    getClaims: () => Promise<unknown>
  }>
}>

type CreateSupabaseProxyClient = (
  env: SupabasePublicEnv,
  cookies: CookieMethodsServer,
) => SupabaseProxyClient

export type SupabaseProxyDependencies = Readonly<{
  createClient: CreateSupabaseProxyClient
  readEnv: () => SupabasePublicEnv
}>

const defaultSupabaseProxyDependencies: SupabaseProxyDependencies = {
  createClient: createSupabaseProxyClient,
  readEnv: readSupabasePublicEnv,
}

export async function refreshSupabaseSessionInProxy(
  request: NextRequest,
  dependencies: SupabaseProxyDependencies = defaultSupabaseProxyDependencies,
): Promise<NextResponse> {
  const env = dependencies.readEnv()
  let response = NextResponse.next({ request })

  const supabase = dependencies.createClient(env, {
    getAll() {
      return request.cookies.getAll()
    },
    setAll(cookiesToSet, headers) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value)
      }

      response = NextResponse.next({ request })

      for (const { name, options, value } of cookiesToSet) {
        response.cookies.set(name, value, options)
      }

      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "set-cookie") {
          response.headers.append(key, value)
        } else {
          response.headers.set(key, value)
        }
      }
    },
  })

  await supabase.auth.getClaims()
  response.headers.set("Cache-Control", AUTH_PROXY_CACHE_CONTROL)

  return response
}

function createSupabaseProxyClient(
  env: SupabasePublicEnv,
  cookies: CookieMethodsServer,
): SupabaseProxyClient {
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, { cookies })
}
