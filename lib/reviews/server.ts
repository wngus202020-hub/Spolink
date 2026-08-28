import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createReviewDependencies } from "./repository"
export async function createReviewRouteSession(headers: Headers) {
  const client = await createSupabaseServerClient(headers)
  const { data } = await client.auth.getClaims()
  const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null
  return { client: createReviewDependencies(client), userId }
}
