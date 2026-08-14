import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"
import { getSupabaseConfigStatus, readSupabasePublicEnv } from "@/lib/supabase/env"

const defaultLessonImagesBucket = "lesson-images"

export function createSupabasePublicReadClient() {
  if (!getSupabaseConfigStatus().configured) {
    return undefined
  }

  const env = readSupabasePublicEnv()

  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey)
}

export function getSupabasePublicStorageUrl(filePath: string, bucket = defaultLessonImagesBucket) {
  if (
    filePath.startsWith("http://") ||
    filePath.startsWith("https://") ||
    filePath.startsWith("/")
  ) {
    return filePath
  }

  if (!getSupabaseConfigStatus().configured) {
    return undefined
  }

  const env = readSupabasePublicEnv()
  const baseUrl = env.supabaseUrl.replace(/\/$/, "")
  const normalizedPath = filePath.startsWith(`${bucket}/`) ? filePath : `${bucket}/${filePath}`

  return `${baseUrl}/storage/v1/object/public/${normalizedPath}`
}
