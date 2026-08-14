"use client"

import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/lib/supabase/database.types"
import { readSupabasePublicEnv } from "@/lib/supabase/env"

export function createSupabaseBrowserClient() {
  const env = readSupabasePublicEnv()

  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey)
}
