import type { CookieOptions } from "@supabase/ssr"
import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { readSupabasePublicEnv } from "../supabase/env"

type FavoriteProfileRow = Readonly<{
  deleted_at: string | null
  id: string
  role: "admin" | "coach" | "learner"
  status: "active" | "coach_approved" | "deleted" | "pending_coach" | "suspended"
}>

type FavoriteMutationDatabase = Readonly<{
  public: {
    CompositeTypes: Record<string, never>
    Enums: Record<string, never>
    Functions: {
      add_lesson_favorite: {
        Args: { checked_lesson_id: string }
        Returns: readonly Readonly<{ favorite_added: boolean; lesson_id: string }>[]
      }
      remove_lesson_favorite: {
        Args: { checked_lesson_id: string }
        Returns: readonly Readonly<{ favorite_removed: boolean; lesson_id: string }>[]
      }
    }
    Tables: {
      profiles: {
        Insert: never
        Relationships: []
        Row: FavoriteProfileRow
        Update: never
      }
    }
    Views: Record<string, never>
  }
}>

export async function createFavoriteMutationClient(responseHeaders: Headers) {
  const env = readSupabasePublicEnv()
  const cookieStore = await cookies()

  return createServerClient<FavoriteMutationDatabase>(env.supabaseUrl, env.supabaseAnonKey, {
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
          if (key.toLowerCase() === "set-cookie") responseHeaders.append(key, value)
          else responseHeaders.set(key, value)
        }
      },
    },
  })
}

export type FavoriteMutationClient = Awaited<ReturnType<typeof createFavoriteMutationClient>>

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
