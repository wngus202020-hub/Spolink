import type { CookieOptions } from "@supabase/ssr"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { cookies } from "next/headers"
import type { Database } from "@/lib/supabase/database.types"
import { readSupabasePublicEnv, readSupabaseServiceEnv } from "@/lib/supabase/env"

export type SupabaseAppClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export async function createSupabaseServerClient(responseHeaders: Headers) {
  const env = readSupabasePublicEnv()
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet, headers) {
        for (const { name, options, value } of cookiesToSet) {
          cookieStore.set(name, value, options)
          responseHeaders.append("Set-Cookie", serializeCookie(name, value, options))
        }

        for (const [key, value] of Object.entries(headers ?? {})) {
          if (key.toLowerCase() === "set-cookie") {
            responseHeaders.append(key, value)
          } else {
            responseHeaders.set(key, value)
          }
        }
      },
    },
  })
}

export function createSupabaseServiceClient() {
  const env = readSupabaseServiceEnv()

  return createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  })
}

function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${value}`]

  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`)
  if (typeof options.domain === "string") parts.push(`Domain=${options.domain}`)
  if (typeof options.path === "string") parts.push(`Path=${options.path}`)
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`)
  if (options.httpOnly === true) parts.push("HttpOnly")
  if (options.secure === true) parts.push("Secure")
  if (typeof options.sameSite === "string") parts.push(`SameSite=${options.sameSite}`)
  if (options.sameSite === true) parts.push("SameSite=Strict")

  return parts.join("; ")
}
