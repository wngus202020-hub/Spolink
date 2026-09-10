import type { AuthUser } from "@/lib/profile/types"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
import { createSupabaseServerClient, type SupabaseAppClient } from "@/lib/supabase/server"
import { createNotificationRepository } from "./repository"
import type { NotificationAccess, NotificationWorkflowDependencies } from "./workflow"

export async function createNotificationDependencies(
  headers: Headers,
): Promise<NotificationWorkflowDependencies> {
  const client = await createSupabaseServerClient(headers)
  return {
    getAccess: () => readNotificationAccess(client),
    repository: createNotificationRepository(client),
  }
}

export async function readNotificationAccess(
  client: SupabaseAppClient,
): Promise<NotificationAccess | "restricted" | "unauthenticated"> {
  const claims = await client.auth.getClaims()
  const userId = typeof claims.data?.claims.sub === "string" ? claims.data.claims.sub : null
  if (claims.error || !userId) return "unauthenticated"
  const profile = await client
    .from("profiles")
    .select("id,status,deleted_at")
    .eq("id", userId)
    .maybeSingle()
  if (
    profile.error ||
    !profile.data ||
    profile.data.deleted_at !== null ||
    ["deleted", "suspended"].includes(profile.data.status)
  ) {
    return "restricted"
  }
  const user: AuthUser = { id: userId }
  return { profileId: userId, user }
}

export const notificationRouteDependencies = {
  createDependencies: createNotificationDependencies,
  isConfigured: () => getSupabaseConfigStatus().configured,
}
