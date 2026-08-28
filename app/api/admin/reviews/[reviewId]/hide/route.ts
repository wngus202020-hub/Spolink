import { createHideReviewRouteHandler } from "@/lib/reviews/route-handler"
import { createReviewRouteSession } from "@/lib/reviews/server"
import { getSupabaseConfigStatus } from "@/lib/supabase/env"
export const POST = createHideReviewRouteHandler({
  configured: () => getSupabaseConfigStatus().configured,
  createClient: async (headers) => createReviewRouteSession(headers),
})
